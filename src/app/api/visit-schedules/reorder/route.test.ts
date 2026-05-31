import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type TestRole = 'owner' | 'admin' | 'pharmacist' | 'pharmacist_trainee' | 'clerk';
type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: TestRole;
};

const {
  authRoleRef,
  withAuthMock,
  withOrgContextMock,
  scheduleFindManyMock,
  scheduleFindFirstMock,
  scheduleUpdateMock,
  membershipFindManyMock,
  pharmacistShiftFindManyMock,
  auditLogCreateMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => {
  const authRoleRef = { current: 'pharmacist' as TestRole };

  return {
    authRoleRef,
    withAuthMock: vi.fn((handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
      return (req: NextRequest) =>
        handler(Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: authRoleRef.current,
        }));
    }),
    withOrgContextMock: vi.fn(),
    scheduleFindManyMock: vi.fn(),
    scheduleFindFirstMock: vi.fn(),
    scheduleUpdateMock: vi.fn(),
    membershipFindManyMock: vi.fn(),
    pharmacistShiftFindManyMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    notifyWorkflowMutationMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-schedules/reorder', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function expectNoWriteAuditOrNotify() {
  expect(scheduleUpdateMock).not.toHaveBeenCalled();
  expect(auditLogCreateMock).not.toHaveBeenCalled();
  expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
}

describe('/api/visit-schedules/reorder PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRoleRef.current = 'pharmacist';
    const schedules = [
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00'),
        time_window_end: new Date('1970-01-01T10:00:00'),
        confirmed_at: null,
      },
      {
        id: 'schedule_2',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T10:00:00'),
        time_window_end: new Date('1970-01-01T11:00:00'),
        confirmed_at: null,
      },
      {
        id: 'schedule_3',
        case_id: 'case_2',
        pharmacist_id: 'pharmacist_2',
        scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00'),
        time_window_end: new Date('1970-01-01T10:00:00'),
        confirmed_at: null,
      },
    ];
    scheduleFindManyMock.mockImplementation(({ where }: { where: { id?: { in?: string[] } } }) => {
      const ids = where.id?.in ?? schedules.map((schedule) => schedule.id);
      return Promise.resolve(schedules.filter((schedule) => ids.includes(schedule.id)));
    });
    scheduleFindFirstMock.mockResolvedValue(null);
    membershipFindManyMock.mockResolvedValue([{ user_id: 'pharmacist_2' }]);
    pharmacistShiftFindManyMock.mockResolvedValue([
      {
        site_id: 'site_2',
        user_id: 'pharmacist_2',
        date: new Date('2026-04-10T00:00:00.000Z'),
        available: true,
        available_from: new Date('1970-01-01T09:00:00'),
        available_to: new Date('1970-01-01T18:00:00'),
      },
    ]);
    scheduleUpdateMock.mockResolvedValue({});
    auditLogCreateMock.mockResolvedValue({});
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: scheduleFindManyMock,
          findFirst: scheduleFindFirstMock,
          update: scheduleUpdateMock,
        },
        membership: {
          findMany: membershipFindManyMock,
        },
        pharmacistShift: {
          findMany: pharmacistShiftFindManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('checks duplicate route orders by resolved date and pharmacist cells', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
          },
          {
            schedule_id: 'schedule_3',
            route_order: 1,
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(scheduleUpdateMock).toHaveBeenCalledTimes(2);

    const duplicateResponse = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
          },
          {
            schedule_id: 'schedule_2',
            route_order: 1,
          },
        ],
      }),
    ))!;

    expect(duplicateResponse.status).toBe(400);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      message: '同一セル内で route_order は重複できません',
    });
  });

  it('denies batches containing unassigned schedules before update, audit, or notify', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00'),
        time_window_end: new Date('1970-01-01T10:00:00'),
        confirmed_at: null,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
          },
          {
            schedule_id: 'schedule_unassigned',
            route_order: 2,
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: '対象の訪問予定が見つかりません',
    });
    expect(scheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['schedule_1', 'schedule_unassigned'] },
        AND: [
          {
            OR: [
              { pharmacist_id: 'user_1' },
              { case_: { primary_pharmacist_id: 'user_1' } },
              { case_: { backup_pharmacist_id: 'user_1' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        case_id: true,
        pharmacist_id: true,
        scheduled_date: true,
        time_window_start: true,
        time_window_end: true,
        confirmed_at: true,
      },
    });
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('rejects existing route order conflicts before update, audit, or notify', async () => {
    scheduleFindFirstMock.mockResolvedValueOnce({ id: 'schedule_existing' });

    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 3,
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同一セル内で route_order は重複できません',
    });
    expect(scheduleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { notIn: ['schedule_1'] },
        OR: [
          {
            pharmacist_id: 'pharmacist_1',
            scheduled_date: new Date('2026-04-09'),
            route_order: 3,
          },
        ],
      },
      select: { id: true },
    });
    expectNoWriteAuditOrNotify();
  });

  it('denies non-bypass assigned users from reassigning to another pharmacist before side effects', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00'),
        time_window_end: new Date('1970-01-01T10:00:00'),
        confirmed_at: null,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
            pharmacist_id: 'pharmacist_2',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '訪問予定のケースまたは担当薬剤師を変更する権限がありません',
    });
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('updates multiple schedules in one batch', async () => {
    authRoleRef.current = 'admin';

    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 2,
          },
          {
            schedule_id: 'schedule_2',
            route_order: 1,
            scheduled_date: '2026-04-10',
            pharmacist_id: 'pharmacist_2',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(scheduleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'schedule_2' },
        data: expect.objectContaining({
          route_order: 1,
          pharmacist_id: 'pharmacist_2',
          site_id: 'site_2',
        }),
      }),
    );
  });

  it('rejects moving a schedule outside the target pharmacist shift', async () => {
    authRoleRef.current = 'admin';

    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00'),
        time_window_end: new Date('1970-01-01T10:00:00'),
        confirmed_at: null,
      },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        site_id: 'site_2',
        user_id: 'pharmacist_2',
        date: new Date('2026-04-10T00:00:00.000Z'),
        available: true,
        available_from: new Date('1970-01-01T10:30:00'),
        available_to: new Date('1970-01-01T18:00:00'),
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
            scheduled_date: '2026-04-10',
            pharmacist_id: 'pharmacist_2',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問開始時刻が薬剤師シフトの開始前です',
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects moving a confirmed schedule to another day or pharmacist', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        confirmed_at: new Date('2026-04-08T12:00:00.000Z'),
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
            scheduled_date: '2026-04-10',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expectNoWriteAuditOrNotify();
  });
});
