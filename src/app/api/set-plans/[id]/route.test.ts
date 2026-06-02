import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, txMock, notifyWorkflowMutationMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    prismaMock: {
      membership: { findFirst: vi.fn() },
      setPlan: { findFirst: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    txMock: {
      packagingMethodMaster: {
        findFirst: vi.fn(),
      },
      setPlan: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    },
    notifyWorkflowMutationMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/set-plans/plan_1', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/set-plans/plan_1', {
    method: 'PATCH',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"set_method":',
  });
}

describe('/api/set-plans/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      set_method: 'custom',
      cycle: {
        case_: {
          patient: {
            name: '山田 太郎',
          },
        },
      },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      target_period_start: new Date('2026-04-01T00:00:00.000Z'),
      target_period_end: new Date('2026-04-07T00:00:00.000Z'),
      set_method: 'custom',
      notes: null,
      packaging_method_id: null,
      cycle: {
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.setPlan.update.mockResolvedValue({
      id: 'plan_1',
      set_method: 'bedtime_only',
      packaging_method_id: null,
      notes: '眠前のみへ変更',
    });
  });

  it('returns the detailed set plan payload', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'plan_1',
      },
    });
    expect(prismaMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
  });

  it('returns 404 for unassigned pharmacist set-plan detail', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    prismaMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expect(prismaMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        AND: [
          {
            cycle: {
              case_: expect.objectContaining({
                OR: expect.arrayContaining([
                  { primary_pharmacist_id: 'user_1' },
                  { backup_pharmacist_id: 'user_1' },
                  { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                ]),
              }),
            },
          },
        ],
      },
      select: expect.any(Object),
    });
  });

  it('updates set plan metadata', async () => {
    const response = await PATCH(
      createRequest({
        set_method: 'bedtime_only',
        notes: '眠前のみへ変更',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expect(txMock.setPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan_1' },
      data: expect.objectContaining({
        set_method: 'bedtime_only',
        notes: '眠前のみへ変更',
      }),
      select: expect.any(Object),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_plans_update', plan_id: 'plan_1' },
    });
  });

  it('rejects non-object patch payloads before transaction side effects', async () => {
    const response = await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.packagingMethodMaster.findFirst).not.toHaveBeenCalled();
    expect(txMock.setPlan.update).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction side effects', async () => {
    const response = await PATCH(createMalformedPatchRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.packagingMethodMaster.findFirst).not.toHaveBeenCalled();
    expect(txMock.setPlan.update).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist set-plan updates before side effects', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    txMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await PATCH(
      createRequest({
        set_method: 'bedtime_only',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expect(txMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        AND: [
          {
            cycle: {
              case_: expect.objectContaining({
                OR: expect.arrayContaining([
                  { primary_pharmacist_id: 'user_1' },
                  { backup_pharmacist_id: 'user_1' },
                  { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                ]),
              }),
            },
          },
        ],
      },
      select: expect.any(Object),
    });
    expect(txMock.setPlan.update).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid target period update', async () => {
    const response = await PATCH(
      createRequest({
        target_period_start: '2026-04-10',
        target_period_end: '2026-04-01',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '終了日は開始日以降を指定してください',
    });
    expect(txMock.setPlan.update).not.toHaveBeenCalled();
  });
});
