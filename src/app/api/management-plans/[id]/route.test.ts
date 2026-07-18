import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuthContext: vi.fn(),
  withOrgContext: vi.fn(),
  acquireLock: vi.fn(),
  createAudit: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  resolveAlert: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<NextResponse>, options: object) =>
    async (req: NextRequest, routeContext: object) => {
      const auth = await mocks.requireAuthContext(req, options);
      if ('response' in auth) return auth.response;
      try {
        const response = await handler(req, auth.ctx, routeContext);
        response.headers.set('cache-control', 'private, no-store, max-age=0');
        response.headers.set('pragma', 'no-cache');
        return response;
      } catch {
        return NextResponse.json(
          { code: 'INTERNAL_ERROR', message: '内部エラーが発生しました' },
          { status: 500, headers: { 'cache-control': 'private, no-store, max-age=0' } },
        );
      }
    },
}));
vi.mock('@/lib/db/rls', () => ({ withOrgContext: mocks.withOrgContext }));
vi.mock('@/lib/db/advisory-lock', () => ({ tryAcquireAdvisoryTxLock: mocks.acquireLock }));
vi.mock('@/lib/audit/audit-entry', () => ({ createAuditLogEntry: mocks.createAudit }));
vi.mock('@/server/services/management-plans', () => ({
  resolveManagementPlanReviewAlert: mocks.resolveAlert,
}));

import { GET, PATCH } from './route';

const ctx = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist',
  requestId: 'req_12345678',
  correlationId: 'cor_12345678',
};
const updatedAt = new Date('2026-07-02T00:00:00.000Z');
const plan = {
  id: 'plan_1',
  case_id: 'case_1',
  title: '計画',
  summary: null,
  content: { goals: ['継続'] },
  status: 'draft',
  version: 1,
  effective_from: null,
  next_review_date: null,
  approved_at: null,
  updated_at: updatedAt,
};

function tx() {
  return {
    managementPlan: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
  };
}

function routeContext(id = 'plan_1') {
  return { params: Promise.resolve({ id }) };
}

function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/management-plans/plan_1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    routeContext(),
  );
}

describe('/api/management-plans/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.requireAuthContext.mockResolvedValue({ ctx });
    mocks.withOrgContext.mockImplementation(async (_orgId, work) => work(tx()));
    mocks.findFirst.mockResolvedValue({ ...plan, case_: { patient_id: 'patient_1' } });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.acquireLock.mockResolvedValue(true);
    mocks.createAudit.mockResolvedValue({ id: 'audit_1' });
    mocks.resolveAlert.mockResolvedValue(undefined);
  });

  it('returns a presented detail only after the PHI audit succeeds', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/management-plans/plan_1'),
      routeContext(),
    );
    expect(response.status).toBe(200);
    expect(mocks.createAudit).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ patientId: 'patient_1', action: 'phi_read' }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { id: 'plan_1', updated_at: updatedAt.toISOString() },
    });
  });

  it.each(['GET', 'PATCH'] as const)(
    'rejects an oversized id before the database for %s',
    async (method) => {
      const oversizedContext = routeContext('a'.repeat(201));
      const response =
        method === 'GET'
          ? await GET(
              new NextRequest('http://localhost/api/management-plans/oversized'),
              oversizedContext,
            )
          : await PATCH(
              new NextRequest('http://localhost/api/management-plans/oversized', {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  action: 'archive',
                  expected_updated_at: updatedAt.toISOString(),
                }),
              }),
              oversizedContext,
            );

      expect(response.status).toBe(400);
      expect(mocks.withOrgContext).not.toHaveBeenCalled();
      expect(mocks.createAudit).not.toHaveBeenCalled();
    },
  );

  it('returns a safe 500 and no PHI when detail content is malformed', async () => {
    mocks.findFirst.mockResolvedValue({
      ...plan,
      content: { nested: { unsafe: true } },
      case_: { patient_id: 'patient_1' },
    });
    const response = await GET(
      new NextRequest('http://localhost/api/management-plans/plan_1'),
      routeContext(),
    );
    expect(response.status).toBe(500);
    expect(mocks.createAudit).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain('unsafe');
  });

  it('returns a non-enumerating 404 without an audit when detail is unavailable', async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('http://localhost/api/management-plans/plan_missing'),
      routeContext('plan_missing'),
    );

    expect(response.status).toBe(404);
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  it('returns a non-enumerating 404 before locking an unassigned mutation', async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await patch({
      action: 'archive',
      expected_updated_at: updatedAt.toISOString(),
    });

    expect(response.status).toBe(404);
    expect(mocks.acquireLock).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.resolveAlert).not.toHaveBeenCalled();
  });

  it('updates a draft under the case lock and advances the CAS token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(updatedAt);
    mocks.findFirst.mockResolvedValueOnce({ case_id: 'case_1' }).mockResolvedValueOnce(plan);
    const response = await patch({
      action: 'update',
      title: '更新',
      expected_updated_at: updatedAt.toISOString(),
    });
    expect(response.status).toBe(200);
    expect(mocks.acquireLock).toHaveBeenCalledWith(
      expect.anything(),
      'management-plan-case',
      'org_1:case_1',
    );
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ updated_at: updatedAt }),
        data: expect.objectContaining({
          title: '更新',
          updated_at: new Date(updatedAt.getTime() + 1),
        }),
      }),
    );
  });

  it('returns a bounded 409 without mutation when the case lock is already held', async () => {
    mocks.findFirst.mockResolvedValueOnce({ case_id: 'case_1' });
    mocks.acquireLock.mockResolvedValue(false);

    const response = await patch({
      action: 'update',
      title: '更新',
      expected_updated_at: updatedAt.toISOString(),
    });

    expect(response.status).toBe(409);
    expect(mocks.findFirst).toHaveBeenCalledOnce();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.resolveAlert).not.toHaveBeenCalled();
  });

  it('stores updated date keys at UTC midnight', async () => {
    mocks.findFirst.mockResolvedValueOnce({ case_id: 'case_1' }).mockResolvedValueOnce(plan);

    const response = await patch({
      action: 'update',
      effective_from: '2026-07-05',
      next_review_date: '2026-07-06',
      expected_updated_at: updatedAt.toISOString(),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          effective_from: new Date('2026-07-05T00:00:00.000Z'),
          next_review_date: new Date('2026-07-06T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('rejects a review date before the retained effective date', async () => {
    mocks.findFirst
      .mockResolvedValueOnce({ case_id: 'case_1' })
      .mockResolvedValueOnce({ ...plan, effective_from: new Date('2026-07-10T00:00:00.000Z') });

    const response = await patch({
      action: 'update',
      next_review_date: '2026-07-09',
      expected_updated_at: updatedAt.toISOString(),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('rejects stale and replayed mutation tokens without a write', async () => {
    mocks.findFirst
      .mockResolvedValueOnce({ case_id: 'case_1' })
      .mockResolvedValueOnce({ ...plan, updated_at: new Date(updatedAt.getTime() + 1) });
    const response = await patch({
      action: 'update',
      title: '更新',
      expected_updated_at: updatedAt.toISOString(),
    });
    expect(response.status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.resolveAlert).not.toHaveBeenCalled();
  });

  it('rejects a sequential replay after a successful update', async () => {
    const advancedAt = new Date(updatedAt.getTime() + 1);
    mocks.findFirst
      .mockResolvedValueOnce({ case_id: 'case_1' })
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce({ ...plan, title: '更新', updated_at: advancedAt })
      .mockResolvedValueOnce({ case_id: 'case_1' })
      .mockResolvedValueOnce({ ...plan, title: '更新', updated_at: advancedAt });
    const body = {
      action: 'update',
      title: '更新',
      expected_updated_at: updatedAt.toISOString(),
    };

    expect((await patch(body)).status).toBe(200);
    expect((await patch(body)).status).toBe(409);
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    expect(mocks.resolveAlert).not.toHaveBeenCalled();
  });

  it('rejects semantic no-op updates with zero side effects', async () => {
    mocks.findFirst.mockResolvedValueOnce({ case_id: 'case_1' }).mockResolvedValueOnce(plan);
    const response = await patch({
      action: 'update',
      title: '計画',
      content: { goals: ['継続'] },
      expected_updated_at: updatedAt.toISOString(),
    });
    expect(response.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each(['draft', 'approved'] as const)(
    'archives a %s plan and resolves its alert',
    async (status) => {
      mocks.findFirst
        .mockResolvedValueOnce({ case_id: 'case_1' })
        .mockResolvedValueOnce({ ...plan, status })
        .mockResolvedValueOnce({ ...plan, status: 'archived' });
      const response = await patch({
        action: 'archive',
        expected_updated_at: updatedAt.toISOString(),
      });
      expect(response.status).toBe(200);
      expect(mocks.resolveAlert).toHaveBeenCalledOnce();
    },
  );

  it.each(['archived', 'superseded'] as const)(
    'rejects archive from %s with zero side effects',
    async (status) => {
      mocks.findFirst
        .mockResolvedValueOnce({ case_id: 'case_1' })
        .mockResolvedValueOnce({ ...plan, status });
      const response = await patch({
        action: 'archive',
        expected_updated_at: updatedAt.toISOString(),
      });
      expect(response.status).toBe(409);
      expect(mocks.updateMany).not.toHaveBeenCalled();
      expect(mocks.resolveAlert).not.toHaveBeenCalled();
    },
  );

  it('rejects a lost archive CAS without resolving its alert', async () => {
    mocks.findFirst
      .mockResolvedValueOnce({ case_id: 'case_1' })
      .mockResolvedValueOnce({ ...plan, status: 'approved' });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await patch({
      action: 'archive',
      expected_updated_at: updatedAt.toISOString(),
    });
    expect(response.status).toBe(409);
    expect(mocks.resolveAlert).not.toHaveBeenCalled();
  });

  it('rejects a case move after acquiring the original case lock', async () => {
    mocks.findFirst
      .mockResolvedValueOnce({ case_id: 'case_1' })
      .mockResolvedValueOnce({ ...plan, case_id: 'case_2' });
    const response = await patch({
      action: 'update',
      title: '更新',
      expected_updated_at: updatedAt.toISOString(),
    });

    expect(response.status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.resolveAlert).not.toHaveBeenCalled();
  });

  it('rolls back with a safe 500 when the guarded row disappears after mutation', async () => {
    mocks.findFirst
      .mockResolvedValueOnce({ case_id: 'case_1' })
      .mockResolvedValueOnce(plan)
      .mockResolvedValueOnce(null);
    const response = await patch({
      action: 'update',
      title: '更新',
      expected_updated_at: updatedAt.toISOString(),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'INTERNAL_ERROR',
      message: '内部エラーが発生しました',
    });
  });

  it('fails approval closed before opening a transaction', async () => {
    const response = await patch({
      action: 'approve',
      expected_updated_at: updatedAt.toISOString(),
    });
    expect(response.status).toBe(400);
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.resolveAlert).not.toHaveBeenCalled();
  });
});
