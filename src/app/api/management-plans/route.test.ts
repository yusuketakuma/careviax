import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const mocks = vi.hoisted(() => ({
  requireAuthContext: vi.fn(),
  withOrgContext: vi.fn(),
  acquireLock: vi.fn(),
  createAudit: vi.fn(),
  careCaseFindFirst: vi.fn(),
  planFindMany: vi.fn(),
  planFindFirst: vi.fn(),
  planCreate: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => Promise<NextResponse>, options: object) =>
    async (req: NextRequest, routeContext = { params: Promise.resolve({}) }) => {
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

import { GET, POST } from './route';

const ctx = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist',
  requestId: 'req_12345678',
  correlationId: 'cor_12345678',
};

const listPlan = {
  id: 'plan_1',
  case_id: 'case_1',
  title: '計画',
  status: 'approved',
  version: 2,
  effective_from: null,
  next_review_date: null,
  approved_at: new Date('2026-07-01T00:00:00.000Z'),
  updated_at: new Date('2026-07-02T00:00:00.000Z'),
};

const detailPlan = {
  ...listPlan,
  status: 'draft',
  version: 3,
  summary: null,
  content: { goals: ['継続'] },
  approved_at: null,
};

function tx() {
  return {
    careCase: { findFirst: mocks.careCaseFindFirst },
    managementPlan: {
      findMany: mocks.planFindMany,
      findFirst: mocks.planFindFirst,
      create: mocks.planCreate,
    },
    auditLog: { create: vi.fn() },
    $executeRaw: vi.fn(),
  };
}

function get(url: string) {
  return GET(new NextRequest(url), { params: Promise.resolve({}) });
}

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/management-plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

describe('/api/management-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthContext.mockResolvedValue({ ctx });
    mocks.withOrgContext.mockImplementation(async (_orgId, work) => work(tx()));
    mocks.careCaseFindFirst.mockResolvedValue({ id: 'case_1', patient_id: 'patient_1' });
    mocks.planFindMany.mockResolvedValue([listPlan]);
    mocks.planFindFirst.mockResolvedValue({ version: 2 });
    mocks.planCreate.mockResolvedValue(detailPlan);
    mocks.acquireLock.mockResolvedValue(true);
    mocks.createAudit.mockResolvedValue({ id: 'audit_1' });
  });

  it('returns a bounded audited case page', async () => {
    const response = await get(
      'http://localhost/api/management-plans?case_id=case_1&status=approved&limit=1',
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(mocks.requireAuthContext).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ permission: 'canViewDashboard' }),
    );
    expect(mocks.planFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', case_id: 'case_1', status: 'approved' },
        orderBy: [{ version: 'desc' }],
        take: 2,
      }),
    );
    expect(mocks.createAudit).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      data: [
        expect.objectContaining({
          id: 'plan_1',
          status: 'approved',
          updated_at: '2026-07-02T00:00:00.000Z',
        }),
      ],
      meta: { has_more: false, next_cursor: null },
    });
  });

  it('uses the last returned version as a stable cursor', async () => {
    mocks.planFindMany.mockResolvedValue([
      { ...listPlan, id: 'plan_3', version: 3 },
      { ...listPlan, id: 'plan_2', version: 2 },
    ]);
    const response = await get(
      'http://localhost/api/management-plans?case_id=case_1&limit=1&cursor=4',
    );
    expect(mocks.planFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', case_id: 'case_1', version: { lt: 4 } },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ version: 3 }],
      meta: { has_more: true, next_cursor: 3 },
    });
  });

  it.each([
    ['', 'missing case_id'],
    ['?case_id=case_1&case_id=case_2', 'duplicate case_id'],
    ['?case_id=case_1&limit=0', 'zero limit'],
    ['?case_id=case_1&limit=-1', 'negative limit'],
    ['?case_id=case_1&limit=1.5', 'fractional limit'],
    ['?case_id=case_1&limit=101', 'limit max+1'],
    ['?case_id=case_1&cursor=2147483648', 'cursor max+1'],
    ['?case_id=case_1&status=unknown', 'unknown status'],
    ['?case_id=case_1&extra=1', 'unknown query'],
    [`?case_id=${'a'.repeat(201)}`, 'oversized case_id'],
  ])('rejects %s before the database (%s)', async (query) => {
    const response = await get(`http://localhost/api/management-plans${query}`);
    expect(response.status).toBe(400);
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
  });

  it('rolls back to a safe 500 when the read audit fails', async () => {
    mocks.createAudit.mockRejectedValue(new Error('audit unavailable'));
    const response = await get('http://localhost/api/management-plans?case_id=case_1');
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('plan_1');
  });

  it('creates the next version under the shared case lock', async () => {
    const response = await post({
      case_id: 'case_1',
      title: '計画',
      content: { goals: ['継続'] },
      expected_latest_version: 2,
    });
    expect(response.status).toBe(201);
    expect(mocks.acquireLock).toHaveBeenCalledWith(
      expect.anything(),
      'management-plan-case',
      'org_1:case_1',
    );
    expect(mocks.planCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 3 }) }),
    );
  });

  it('rejects an inaccessible case without disclosing or writing it', async () => {
    mocks.careCaseFindFirst.mockResolvedValue(null);

    const response = await post({
      case_id: 'case_other_org',
      title: '計画',
      expected_latest_version: 0,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { case_id: ['指定されたケースを確認できません'] },
    });
    expect(mocks.planFindFirst).not.toHaveBeenCalled();
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible source plan without creating a copy', async () => {
    mocks.planFindFirst.mockResolvedValue(null);

    const response = await post({
      case_id: 'case_1',
      source_plan_id: 'plan_other_case',
      title: '計画',
      expected_latest_version: 0,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { source_plan_id: ['指定された複製元を確認できません'] },
    });
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique version conflict to 409', async () => {
    mocks.planCreate.mockRejectedValue(
      Object.assign(new Error('unique conflict'), { code: 'P2002' }),
    );

    const response = await post({
      case_id: 'case_1',
      title: '計画',
      expected_latest_version: 2,
    });

    expect(response.status).toBe(409);
    expect(mocks.planCreate).toHaveBeenCalledOnce();
  });

  it('returns a bounded 409 immediately when the case lock is already held', async () => {
    mocks.acquireLock.mockResolvedValue(false);

    const response = await post({
      case_id: 'case_1',
      title: '計画',
      expected_latest_version: 2,
    });

    expect(response.status).toBe(409);
    expect(mocks.careCaseFindFirst).not.toHaveBeenCalled();
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

  it('normalizes create text and stores date keys at UTC midnight', async () => {
    const response = await post({
      case_id: '  case_1  ',
      source_plan_id: '  plan_0  ',
      title: '  計画  ',
      summary: '   ',
      effective_from: '2026-07-05',
      next_review_date: '2026-07-06',
      expected_latest_version: 2,
    });

    expect(response.status).toBe(201);
    expect(mocks.careCaseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'case_1' }) }),
    );
    expect(mocks.planFindFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ id: 'plan_0' }) }),
    );
    expect(mocks.planCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '計画',
          summary: null,
          source_plan_id: 'plan_0',
          effective_from: new Date('2026-07-05T00:00:00.000Z'),
          next_review_date: new Date('2026-07-06T00:00:00.000Z'),
        }),
      }),
    );
  });

  it.each([1, 2_147_483_647])(
    'fails closed for stale or exhausted expected version %s',
    async (latestVersion) => {
      mocks.planFindFirst.mockResolvedValue({ version: latestVersion });
      const response = await post({
        case_id: 'case_1',
        title: '計画',
        expected_latest_version: latestVersion === 1 ? 0 : latestVersion,
      });
      expect(response.status).toBe(409);
      expect(mocks.planCreate).not.toHaveBeenCalled();
    },
  );

  it('rejects out-of-range versions and strict clinical content before DB', async () => {
    const response = await post({
      case_id: 'case_1',
      title: '計画',
      expected_latest_version: 2_147_483_648,
      content: { nested: { unsafe: true } },
    });
    expect(response.status).toBe(400);
    expect(mocks.withOrgContext).not.toHaveBeenCalled();
  });
});
