import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  buildSetPlanAssignmentWhereMock,
  loggerErrorMock,
  prismaMock,
  withOrgContextMock,
  txMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  buildSetPlanAssignmentWhereMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
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
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

vi.mock('@/server/services/prescription-access', () => ({
  buildSetPlanAssignmentWhere: buildSetPlanAssignmentWhereMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, PATCH } from './route';
import { expectNoStore } from '@/test/api-response-assertions';

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
    buildSetPlanAssignmentWhereMock.mockReturnValue(null);
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin', site_id: null });
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
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'plan_1',
      },
    });
    expect(txMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        }),
      }),
    );
  });

  it('returns 404 for unassigned pharmacist set-plan detail', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist', site_id: null });
    txMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(txMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
  });

  it('returns a sanitized no-store 500 when set plan detail lookup fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田太郎 東京都千代田区 raw set plan packaging detail');
    unsafeError.name = 'SetPlanDetailSecretError';
    txMock.setPlan.findFirst.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区');
    expect(JSON.stringify(body)).not.toContain('raw set plan packaging detail');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'set_plans_detail_get_unhandled_error',
        route: '/api/set-plans/[id]',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('山田太郎');
    expect(serializedRouteContext).not.toContain('東京都千代田区');
    expect(serializedRouteContext).not.toContain('raw set plan packaging detail');
    expect(serializedRouteContext).not.toContain('SetPlanDetailSecretError');
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
    expectNoStore(response);
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
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        }),
      }),
    );
  });

  it('reapplies set plan assignment scope to the write claim and post-update read', async () => {
    const assignmentWhere = {
      cycle: {
        case_: {
          primary_pharmacist_id: 'user_1',
        },
      },
    };
    buildSetPlanAssignmentWhereMock.mockReturnValue(assignmentWhere);

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

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(txMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        AND: [assignmentWhere],
      },
      select: expect.any(Object),
    });
    expect(txMock.setPlan.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        updated_at: new Date(currentUpdatedAt),
        AND: [assignmentWhere],
      },
      data: expect.any(Object),
    });
    expect(txMock.setPlan.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        AND: [assignmentWhere],
      },
      select: expect.any(Object),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_plans_update', plan_id: 'plan_1' },
    });
  });

  it('revalidates an existing active packaging method before refreshing the snapshot', async () => {
    txMock.setPlan.findFirst
      .mockResolvedValueOnce({
        id: 'plan_1',
        target_period_start: new Date('2026-04-01T00:00:00.000Z'),
        target_period_end: new Date('2026-04-07T00:00:00.000Z'),
        set_method: 'custom',
        notes: null,
        packaging_method_id: 'pm_active',
        updated_at: new Date(currentUpdatedAt),
        cycle: {
          case_: {
            patient: {
              packaging_profile: null,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'plan_1',
        target_period_start: new Date('2026-04-01T00:00:00.000Z'),
        target_period_end: new Date('2026-04-07T00:00:00.000Z'),
        set_method: 'custom',
        notes: '確認済み',
        packaging_method_id: 'pm_active',
        updated_at: new Date(currentUpdatedAt),
        cycle: {
          case_: {
            patient: {
              packaging_profile: null,
            },
          },
        },
      });
    txMock.packagingMethodMaster.findFirst.mockResolvedValueOnce({
      id: 'pm_active',
      name: '一包化',
      description: '有効な配薬方法',
    });

    const response = await PATCH(
      createRequest({
        expected_updated_at: currentUpdatedAt,
        notes: '確認済み',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(txMock.packagingMethodMaster.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'pm_active',
        org_id: 'org_1',
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });
    expect(txMock.setPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          packaging_summary_snapshot: expect.objectContaining({
            packaging_method_id: 'pm_active',
            packaging_method_name: '一包化',
          }),
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_plans_update', plan_id: 'plan_1' },
    });
  });

  it('rejects stale inactive packaging methods before refreshing the snapshot', async () => {
    txMock.setPlan.findFirst.mockResolvedValueOnce({
      id: 'plan_1',
      target_period_start: new Date('2026-04-01T00:00:00.000Z'),
      target_period_end: new Date('2026-04-07T00:00:00.000Z'),
      set_method: 'custom',
      notes: null,
      packaging_method_id: 'pm_inactive',
      updated_at: new Date(currentUpdatedAt),
      cycle: {
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.packagingMethodMaster.findFirst.mockResolvedValueOnce(null);

    const response = await PATCH(
      createRequest({
        expected_updated_at: currentUpdatedAt,
        notes: '確認済み',
      }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '現在の配薬方法マスタは無効です。配薬方法を選び直してください',
    });
    expect(txMock.packagingMethodMaster.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'pm_inactive',
        org_id: 'org_1',
        is_active: true,
      },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when set plan update fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田太郎 東京都千代田区 raw set plan packaging update');
    unsafeError.name = 'SetPlanPatchSecretError';
    withOrgContextMock.mockRejectedValueOnce(unsafeError);

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

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('東京都千代田区');
    expect(JSON.stringify(body)).not.toContain('raw set plan packaging update');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'set_plans_detail_patch_unhandled_error',
        route: '/api/set-plans/[id]',
        method: 'PATCH',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('山田太郎');
    expect(serializedRouteContext).not.toContain('東京都千代田区');
    expect(serializedRouteContext).not.toContain('raw set plan packaging update');
    expect(serializedRouteContext).not.toContain('SetPlanPatchSecretError');
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
    expectNoStore(response);
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
    expectNoStore(response);
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
    expectNoStore(response);
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
    expectNoStore(response);
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
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist', site_id: null });
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
    expectNoStore(response);
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
    expectNoStore(response);
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
    expectNoStore(response);
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
    expectNoStore(response);
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
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '終了日は開始日以降を指定してください',
    });
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
