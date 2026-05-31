import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  setPlanFindManyMock,
  setPlanCreateMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  packagingMethodFindFirstMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  setPlanFindManyMock: vi.fn(),
  setPlanCreateMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  packagingMethodFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
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

import { GET, POST } from './route';

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

describe('/api/set-plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    setPlanFindManyMock.mockResolvedValue([{ id: 'plan_1' }]);
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
          create: setPlanCreateMock,
        },
      }),
    );
  });

  it('lists set plans filtered by cycle', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(createRequest('http://localhost/api/set-plans?cycle_id=cycle_1')))!;

    expect(response.status).toBe(200);
    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
        },
      }),
    );
  });

  it('returns an empty list for trainee users when the cycle belongs to an unassigned case', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });
    setPlanFindManyMock.mockResolvedValue([]);

    const response = (await GET(createRequest('http://localhost/api/set-plans?cycle_id=cycle_1')))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: [] });
    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
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
      }),
    );
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
    expect(setPlanCreateMock).toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', version: 1 },
      data: { overall_status: 'setting', version: { increment: 1 } },
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalled();
  });

  it('rejects unassigned pharmacist set-plan creation before writes or cycle transition', async () => {
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
        AND: [
          {
            case_: expect.objectContaining({
              OR: expect.arrayContaining([
                { primary_pharmacist_id: 'user_1' },
                { backup_pharmacist_id: 'user_1' },
                { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
              ]),
            }),
          },
        ],
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
});
