import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  loggerErrorMock,
  authMock,
  membershipFindFirstMock,
  setPlanFindManyMock,
  setPlanTxFindFirstMock,
  setPlanCreateMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  packagingMethodFindFirstMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  setPlanFindManyMock: vi.fn(),
  setPlanTxFindFirstMock: vi.fn(),
  setPlanCreateMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  packagingMethodFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    setPlan: {
      findMany: setPlanFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const GET = (req: NextRequest) => rawGET(req);
const POST = (req: NextRequest) => rawPOST(req);

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-org-id': 'org_1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/set-plans', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"cycle_id":',
  });
}

function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: {
      target: ['org_id', 'cycle_id', 'target_period_start', 'target_period_end', 'set_method'],
    },
  });
}

describe('/api/set-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    setPlanFindManyMock.mockResolvedValue([{ id: 'plan_1' }]);
    setPlanTxFindFirstMock.mockResolvedValue(null);
    setPlanCreateMock.mockResolvedValue({ id: 'plan_2' });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'audited',
      version: 1,
      case_: { patient: { packaging_profile: null } },
    });
    medicationCycleUpdateManyMock.mockResolvedValue({ count: 1 });
    cycleTransitionLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'cycle_1', overall_status: 'setting' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        packagingMethodMaster: {
          findFirst: packagingMethodFindFirstMock,
        },
        setPlan: {
          findMany: setPlanFindManyMock,
          findFirst: setPlanTxFindFirstMock,
          create: setPlanCreateMock,
        },
      }),
    );
  });

  it('lists set plans filtered by cycle', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(createRequest('http://localhost/api/set-plans?cycle_id=cycle_1')))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
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
    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
        },
      }),
    );
  });

  it('lists set plans filtered by patient for direct set calendar entry', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest('http://localhost/api/set-plans?patient_id=patient_1'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle: { patient_id: 'patient_1' },
        },
      }),
    );
  });

  it('lists set plans org-wide for trainee users without assignment scoping', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });
    setPlanFindManyMock.mockResolvedValue([{ id: 'plan_1' }]);

    const response = (await GET(createRequest('http://localhost/api/set-plans?cycle_id=cycle_1')))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ data: [{ id: 'plan_1' }] });
    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
        },
      }),
    );
  });

  it.each([
    ['cycle_id=', 'cycle_id', 'cycle_id が不正です'],
    ['cycle_id=%20cycle_1%20', 'cycle_id', 'cycle_id が不正です'],
    [`cycle_id=${'a'.repeat(101)}`, 'cycle_id', 'cycle_id が不正です'],
    ['patient_id=', 'patient_id', 'patient_id が不正です'],
    ['patient_id=%20patient_1', 'patient_id', 'patient_id が不正です'],
    [`patient_id=${'a'.repeat(101)}`, 'patient_id', 'patient_id が不正です'],
  ])(
    'rejects blank or malformed set-plan filter query "%s" before DB access',
    async (query, fieldName, message) => {
      const response = (await GET(createRequest(`http://localhost/api/set-plans?${query}`)))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: {
          [fieldName]: [message],
        },
      });
      expect(setPlanFindManyMock).not.toHaveBeenCalled();
      expect(withOrgContextMock).not.toHaveBeenCalled();
      expect(setPlanCreateMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['cycle_id=cycle_1&cycle_id=cycle_2', 'cycle_id'],
    ['patient_id=patient_1&patient_id=patient_2', 'patient_id'],
  ])('rejects duplicate set-plan filter query "%s" before DB access', async (query, fieldName) => {
    const response = (await GET(createRequest(`http://localhost/api/set-plans?${query}`)))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: {
        [fieldName]: [`${fieldName} は1つだけ指定してください`],
      },
    });
    expect(setPlanFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setPlanCreateMock).not.toHaveBeenCalled();
  });

  it('creates a set plan and advances the cycle into setting', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/set-plans', {
        cycle_id: 'cycle_1',
        target_period_start: '2026-04-01',
        target_period_end: '2026-04-07',
        set_method: 'custom',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ replayed: false });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        }),
      }),
    );
    expect(setPlanTxFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        target_period_start: new Date('2026-04-01'),
        target_period_end: new Date('2026-04-07'),
        set_method: 'custom',
      },
    });
    expect(setPlanCreateMock).toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1', version: 1 },
      data: { overall_status: 'setting', version: { increment: 1 } },
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalled();
  });

  it('replays an existing set plan for the same cycle period and method without transition side effects', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      overall_status: 'setting',
      version: 2,
      case_: { patient: { packaging_profile: null } },
    });
    setPlanTxFindFirstMock.mockResolvedValueOnce({
      id: 'plan_existing',
      org_id: 'org_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-04-01'),
      target_period_end: new Date('2026-04-07'),
      set_method: 'custom',
    });

    const response = (await POST(
      createRequest('http://localhost/api/set-plans', {
        cycle_id: 'cycle_1',
        target_period_start: '2026-04-01',
        target_period_end: '2026-04-07',
        set_method: 'custom',
      }),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      replayed: true,
      data: { id: 'plan_existing' },
    });
    expect(setPlanCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('converges a concurrent duplicate set-plan create race to the existing plan', async () => {
    setPlanTxFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'plan_race',
      org_id: 'org_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-04-01'),
      target_period_end: new Date('2026-04-07'),
      set_method: 'custom',
    });
    setPlanCreateMock.mockRejectedValueOnce(buildUniqueConstraintError());

    const response = (await POST(
      createRequest('http://localhost/api/set-plans', {
        cycle_id: 'cycle_1',
        target_period_start: '2026-04-01',
        target_period_end: '2026-04-07',
        set_method: 'custom',
      }),
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      replayed: true,
      data: { id: 'plan_race' },
    });
    expect(setPlanCreateMock).toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before cycle lookup or writes', async () => {
    const response = (await POST(createRequest('http://localhost/api/set-plans', [])))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(packagingMethodFindFirstMock).not.toHaveBeenCalled();
    expect(setPlanCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before cycle lookup or writes', async () => {
    const response = (await POST(createMalformedPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(packagingMethodFindFirstMock).not.toHaveBeenCalled();
    expect(setPlanCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated malformed JSON before parsing or writes', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = (await POST(createMalformedPostRequest()))!;

    expect(response.status).toBe(401);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(packagingMethodFindFirstMock).not.toHaveBeenCalled();
    expect(setPlanCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when set-plan listing fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田太郎 raw set plan list medication notes');
    unsafeError.name = 'SetPlanListSecretError';
    setPlanFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createRequest('http://localhost/api/set-plans?cycle_id=cycle_1')))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw set plan list');
    expect(JSON.stringify(body)).not.toContain('medication notes');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'set_plans_get_unhandled_error',
        route: '/api/set-plans',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('山田太郎');
    expect(serializedRouteContext).not.toContain('raw set plan list');
    expect(serializedRouteContext).not.toContain('medication notes');
    expect(serializedRouteContext).not.toContain('SetPlanListSecretError');
  });

  it('returns a sanitized no-store 500 when set-plan creation fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田太郎 raw set plan create medication notes');
    unsafeError.name = 'SetPlanCreateSecretError';
    withOrgContextMock.mockRejectedValueOnce(unsafeError);

    const response = (await POST(
      createRequest('http://localhost/api/set-plans', {
        cycle_id: 'cycle_1',
        target_period_start: '2026-04-01',
        target_period_end: '2026-04-07',
        set_method: 'custom',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw set plan create');
    expect(JSON.stringify(body)).not.toContain('medication notes');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'set_plans_post_unhandled_error',
        route: '/api/set-plans',
        method: 'POST',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('山田太郎');
    expect(serializedRouteContext).not.toContain('raw set plan create');
    expect(serializedRouteContext).not.toContain('medication notes');
    expect(serializedRouteContext).not.toContain('SetPlanCreateSecretError');
  });

  it('rejects pharmacist set-plan creation when the cycle is not found in-org before writes or cycle transition', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    medicationCycleFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createRequest('http://localhost/api/set-plans', {
        cycle_id: 'cycle_1',
        target_period_start: '2026-04-01',
        target_period_end: '2026-04-07',
        set_method: 'custom',
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'cycle_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
    expect(setPlanCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a target period whose end date is before the start date', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/set-plans', {
        cycle_id: 'cycle_1',
        target_period_start: '2026-04-07',
        target_period_end: '2026-04-01',
        set_method: 'custom',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        target_period_end: ['終了日は開始日以降を指定してください'],
      },
    });
    expect(setPlanCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a target period longer than the set calendar safety limit before writes', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/set-plans', {
        cycle_id: 'cycle_1',
        target_period_start: '2026-04-01',
        target_period_end: '2026-05-10',
        set_method: 'custom',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        target_period_end: ['セット対象期間は35日以内で指定してください'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setPlanCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects impossible calendar dates before they can be normalized by Date parsing', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/set-plans', {
        cycle_id: 'cycle_1',
        target_period_start: '2026-02-31',
        target_period_end: '2026-03-07',
        set_method: 'custom',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        target_period_start: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(packagingMethodFindFirstMock).not.toHaveBeenCalled();
    expect(setPlanCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
  });
});
