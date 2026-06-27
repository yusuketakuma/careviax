import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
        updateMany: vi.fn(),
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
  const originalTimezone = process.env.TZ;
  const currentUpdatedAt = '2026-04-01T09:00:00.000Z';

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

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
      updated_at: new Date(currentUpdatedAt),
      cycle: {
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.setPlan.updateMany.mockResolvedValue({ count: 1 });
  });

  it('returns the detailed set plan payload', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(prismaMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
  });

  it('returns a sanitized no-store 500 when set plan detail lookup fails unexpectedly', async () => {
    prismaMock.setPlan.findFirst.mockRejectedValueOnce(
      new Error('患者 山田太郎 東京都千代田区 raw set plan packaging detail'),
    );

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区');
    expect(JSON.stringify(body)).not.toContain('raw set plan packaging detail');
  });

  it('updates set plan metadata', async () => {
    const response = await PATCH(
      createRequest({
        expected_updated_at: currentUpdatedAt,
        set_method: 'bedtime_only',
        notes: '眠前のみへ変更',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expect(txMock.setPlan.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        updated_at: new Date(currentUpdatedAt),
      },
      data: expect.objectContaining({
        set_method: 'bedtime_only',
        notes: '眠前のみへ変更',
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_plans_update', plan_id: 'plan_1' },
    });
  });

  it('requires a set plan freshness token before transaction side effects', async () => {
    const response = await PATCH(
      createRequest({
        set_method: 'bedtime_only',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.packagingMethodMaster.findFirst).not.toHaveBeenCalled();
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the set plan was updated after the client loaded it', async () => {
    txMock.setPlan.findFirst.mockResolvedValueOnce({
      id: 'plan_1',
      target_period_start: new Date('2026-04-01T00:00:00.000Z'),
      target_period_end: new Date('2026-04-07T00:00:00.000Z'),
      set_method: 'custom',
      notes: null,
      packaging_method_id: null,
      updated_at: new Date('2026-04-01T09:05:00.000Z'),
      cycle: {
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });

    const response = await PATCH(
      createRequest({
        expected_updated_at: currentUpdatedAt,
        set_method: 'bedtime_only',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'セットプランが他のユーザーによって更新されています。再読み込みしてください',
      details: {
        current: { updated_at: '2026-04-01T09:05:00.000Z' },
        expected_updated_at: currentUpdatedAt,
      },
    });
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
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
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist set-plan updates before side effects', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    txMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await PATCH(
      createRequest({
        expected_updated_at: currentUpdatedAt,
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
      },
      select: expect.any(Object),
    });
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid target period update', async () => {
    const response = await PATCH(
      createRequest({
        expected_updated_at: currentUpdatedAt,
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
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a target period update longer than the set calendar safety limit', async () => {
    const response = await PATCH(
      createRequest({
        expected_updated_at: currentUpdatedAt,
        target_period_start: '2026-04-01',
        target_period_end: '2026-05-10',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'セット対象期間は35日以内で指定してください',
    });
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects impossible target period dates before transaction side effects', async () => {
    const response = await PATCH(
      createRequest({
        target_period_start: '2026-04-31',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('validates existing target period dates by the local pharmacy calendar day', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      target_period_start: new Date('2026-04-01T15:30:00.000Z'),
      target_period_end: new Date('2026-04-07T00:00:00.000Z'),
      set_method: 'custom',
      notes: null,
      packaging_method_id: null,
      updated_at: new Date(currentUpdatedAt),
      cycle: {
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });

    const response = await PATCH(
      createRequest({
        expected_updated_at: currentUpdatedAt,
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
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
