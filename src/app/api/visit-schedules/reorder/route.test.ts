import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

type TestRole = 'owner' | 'admin' | 'pharmacist' | 'pharmacist_trainee' | 'clerk';

const {
  authRoleRef,
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  scheduleFindManyMock,
  scheduleFindFirstMock,
  scheduleCountMock,
  scheduleUpdateManyMock,
  proposalFindFirstMock,
  vehicleFindManyMock,
  membershipFindManyMock,
  pharmacistShiftFindManyMock,
  auditLogCreateMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => {
  const authRoleRef = { current: 'pharmacist' as TestRole };

  return {
    authRoleRef,
    authMock: vi.fn(),
    membershipFindFirstMock: vi.fn(),
    withOrgContextMock: vi.fn(),
    scheduleFindManyMock: vi.fn(),
    scheduleFindFirstMock: vi.fn(),
    scheduleCountMock: vi.fn(),
    scheduleUpdateManyMock: vi.fn(),
    proposalFindFirstMock: vi.fn(),
    vehicleFindManyMock: vi.fn(),
    membershipFindManyMock: vi.fn(),
    pharmacistShiftFindManyMock: vi.fn(),
    auditLogCreateMock: vi.fn(),
    notifyWorkflowMutationMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { PATCH as rawPATCH } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const emptyRouteContext = { params: Promise.resolve({}) };
const PATCH = (req: NextRequest) => rawPATCH(req, emptyRouteContext);

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-schedules/reorder', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/visit-schedules/reorder', {
    method: 'PATCH',
    body: '{"updates":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function expectNoWriteAuditOrNotify() {
  expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
  expect(auditLogCreateMock).not.toHaveBeenCalled();
  expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
}

describe('/api/visit-schedules/reorder PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRoleRef.current = 'pharmacist';
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockImplementation(() =>
      Promise.resolve({ role: authRoleRef.current }),
    );
    const schedules = [
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
      {
        id: 'schedule_2',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T10:00:00.000Z'),
        time_window_end: new Date('1970-01-01T11:00:00.000Z'),
        confirmed_at: null,
        route_order: 2,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
      {
        id: 'schedule_3',
        case_id: 'case_2',
        pharmacist_id: 'pharmacist_2',
        scheduled_date: new Date('2026-04-10T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_2',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
      {
        id: 'schedule_confirmed_tail',
        case_id: 'case_confirmed_tail',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T11:00:00.000Z'),
        time_window_end: new Date('1970-01-01T12:00:00.000Z'),
        confirmed_at: new Date('2026-04-08T12:00:00.000Z'),
        route_order: 3,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
    ];
    scheduleFindManyMock.mockImplementation(
      ({
        where,
      }: {
        where: {
          id?: { in?: string[]; notIn?: string[] };
          vehicle_resource_id?: { in?: string[] };
          scheduled_date?: { in?: Date[] };
        };
      }) => {
        if (where.vehicle_resource_id?.in) {
          const dateKeys = new Set(
            (where.scheduled_date?.in ?? []).map((date) => date.toISOString()),
          );
          const excludedIds = new Set(where.id?.notIn ?? []);
          return Promise.resolve(
            schedules.filter(
              (schedule) =>
                schedule.vehicle_resource_id &&
                where.vehicle_resource_id?.in?.includes(schedule.vehicle_resource_id) &&
                dateKeys.has(schedule.scheduled_date.toISOString()) &&
                !excludedIds.has(schedule.id),
            ),
          );
        }

        const ids = where.id?.in ?? schedules.map((schedule) => schedule.id);
        return Promise.resolve(schedules.filter((schedule) => ids.includes(schedule.id)));
      },
    );
    scheduleFindFirstMock.mockResolvedValue(null);
    scheduleCountMock.mockResolvedValue(0);
    proposalFindFirstMock.mockResolvedValue(null);
    const vehicles = [
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '軽バン1号',
        max_stops: 4,
        max_route_duration_minutes: null,
        travel_mode: 'DRIVE',
        site: {
          address: '薬局',
          lat: 35.681236,
          lng: 139.767125,
        },
      },
      {
        id: 'vehicle_2',
        site_id: 'site_2',
        label: '軽バン2号',
        max_stops: 4,
        max_route_duration_minutes: null,
        travel_mode: 'DRIVE',
        site: {
          address: '別拠点',
          lat: 35.7,
          lng: 139.7,
        },
      },
    ];
    vehicleFindManyMock.mockImplementation(({ where }: { where: { id?: { in?: string[] } } }) => {
      const ids = where.id?.in ?? vehicles.map((vehicle) => vehicle.id);
      return Promise.resolve(vehicles.filter((vehicle) => ids.includes(vehicle.id)));
    });
    membershipFindManyMock.mockResolvedValue([{ user_id: 'pharmacist_2' }]);
    pharmacistShiftFindManyMock.mockResolvedValue([
      {
        site_id: 'site_2',
        user_id: 'pharmacist_2',
        date: new Date('2026-04-10T00:00:00.000Z'),
        available: true,
        available_from: new Date('1970-01-01T09:00:00.000Z'),
        available_to: new Date('1970-01-01T18:00:00.000Z'),
      },
    ]);
    scheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({});
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: scheduleFindManyMock,
          findFirst: scheduleFindFirstMock,
          count: scheduleCountMock,
          updateMany: scheduleUpdateManyMock,
        },
        visitVehicleResource: {
          findMany: vehicleFindManyMock,
        },
        visitScheduleProposal: {
          findFirst: proposalFindFirstMock,
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
    expectSensitiveNoStore(response);
    expect(scheduleUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

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

  it('checks duplicate route orders by UTC calendar date', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_midnight',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
      {
        id: 'schedule_daytime',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T13:00:00.000Z'),
        time_window_start: new Date('1970-01-01T13:00:00.000Z'),
        time_window_end: new Date('1970-01-01T14:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_midnight',
            route_order: 1,
          },
          {
            schedule_id: 'schedule_daytime',
            route_order: 1,
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同一セル内で route_order は重複できません',
    });
    expectNoWriteAuditOrNotify();
  });

  it('denies batches containing schedules missing in-org before update, audit, or notify', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
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
      },
      select: {
        id: true,
        case_id: true,
        pharmacist_id: true,
        scheduled_date: true,
        time_window_start: true,
        time_window_end: true,
        confirmed_at: true,
        route_order: true,
        site_id: true,
        schedule_status: true,
        vehicle_resource_id: true,
        version: true,
        case_: {
          select: {
            patient: {
              select: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(proposalFindFirstMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('rejects non-object reorder payloads before loading schedules', async () => {
    const response = (await PATCH(createRequest(['schedule_1'])))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('rejects malformed JSON reorder payloads before loading schedules', async () => {
    const response = (await PATCH(createMalformedJsonRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('rejects invalid scheduled_date values before loading schedules', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
            scheduled_date: '2026-02-30',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        updates: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('rejects timestamp scheduled_date values before loading schedules', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
            scheduled_date: '2026-04-09T00:00:00Z',
          },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        updates: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(scheduleFindManyMock).not.toHaveBeenCalled();
    expect(scheduleFindFirstMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
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
        id: { not: 'schedule_1' },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09'),
        route_order: 3,
      },
      select: { id: true },
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects existing open proposal route order conflicts before update, audit, or notify', async () => {
    proposalFindFirstMock.mockResolvedValueOnce({ id: 'proposal_existing' });

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
    expect(proposalFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-04-09'),
        route_order: 3,
      },
      select: { id: true },
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects arbitrary audit source text before loading schedules', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
        confirmation_context: {
          source: 'patient-name-or-free-text',
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('accepts emergency route interruption confirmation context and records it in audit', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
        confirmation_context: {
          source: 'emergency_route_interruption',
          date: '2026-04-09',
          travel_mode: 'DRIVE',
          target_count: 1,
          route_order_diff_count: 1,
          released_schedule_id: 'schedule_confirmed_tail',
          patient_reconfirmation_required: true,
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'visit_schedules_reordered',
          changes: expect.objectContaining({
            confirmation_context: {
              source: 'emergency_route_interruption',
              date: '2026-04-09',
              travel_mode: 'DRIVE',
              target_count: 1,
              route_order_diff_count: 1,
              released_schedule_id: 'schedule_confirmed_tail',
              patient_reconfirmation_required: true,
              patient_reconfirmation_acknowledged_by: 'user_1',
              patient_reconfirmation_acknowledged_at: expect.any(String),
            },
          }),
        }),
      }),
    );
  });

  it('rejects emergency reconfirmation context when the released schedule is not same-day confirmed', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
      {
        id: 'schedule_unconfirmed_tail',
        case_id: 'case_unconfirmed_tail',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T11:00:00.000Z'),
        time_window_end: new Date('1970-01-01T12:00:00.000Z'),
        confirmed_at: null,
        route_order: 3,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
        confirmation_context: {
          source: 'emergency_route_interruption',
          date: '2026-04-09',
          target_count: 1,
          route_order_diff_count: 1,
          released_schedule_id: 'schedule_unconfirmed_tail',
          patient_reconfirmation_required: true,
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '確認コンテキストが訪問予定の対象セルと一致しません',
    });
    expectNoWriteAuditOrNotify();
  });

  it('accepts schedule conflict resolution confirmation context and records it in audit', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [
          {
            schedule_id: 'schedule_1',
            route_order: 1,
            pharmacist_id: 'pharmacist_2',
          },
        ],
        confirmation_context: {
          source: 'schedule_conflict_resolution',
          date: '2026-04-09',
          pharmacist_id: 'pharmacist_2',
          target_count: 1,
          route_order_diff_count: 1,
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'visit_schedules_reordered',
          changes: expect.objectContaining({
            confirmation_context: {
              source: 'schedule_conflict_resolution',
              date: '2026-04-09',
              pharmacist_id: 'pharmacist_2',
              target_count: 1,
              route_order_diff_count: 1,
            },
          }),
        }),
      }),
    );
  });

  it('rejects duplicate schedule targets before loading schedules', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [
          { schedule_id: 'schedule_1', route_order: 1 },
          { schedule_id: 'schedule_1', route_order: 2 },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同じ訪問予定を複数回指定できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('rejects confirmation context that does not match a single target route cell', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
        confirmation_context: {
          source: 'schedule_day_route_preview',
          date: '2026-04-10',
          pharmacist_id: 'pharmacist_1',
          target_count: 1,
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '確認コンテキストが訪問予定の対象セルと一致しません',
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects stale expected route_order before schedule route writes', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1, expected_route_order: 2 }],
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expectNoWriteAuditOrNotify();
  });

  it('retries serializable schedule route conflicts and succeeds on retry', async () => {
    withOrgContextMock.mockImplementationOnce(async () => {
      throw buildSerializableConflictError();
    });

    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(scheduleUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('returns conflict when serializable schedule route conflicts exceed retry limit', async () => {
    withOrgContextMock.mockImplementation(async () => {
      throw buildSerializableConflictError();
    });

    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expectNoWriteAuditOrNotify();
  });

  it('rejects stale expected route_order before schedule writes', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 3, expected_route_order: 2 }],
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expectNoWriteAuditOrNotify();
  });

  it('returns a sanitized no-store 500 when auth plumbing fails before body parsing', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw auth visit schedule reorder patient 山田 花子 token secret'),
    );

    const response = (await PATCH(createRequest(['schedule_1'])))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('returns a sanitized no-store 500 when route transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw reorder transaction patient 山田 花子 token secret route memo'),
    );

    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw reorder');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when a guarded schedule write loses the race', async () => {
    scheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows org-wide users to reassign to another pharmacist', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
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

    expect(response.status).toBe(200);
    expect(membershipFindManyMock).toHaveBeenCalled();
    expect(scheduleUpdateManyMock).toHaveBeenCalled();
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
        confirmation_context: {
          source: 'schedule_day_route_preview',
          date: '2026-04-09',
          pharmacist_id: 'pharmacist_1',
          travel_mode: 'DRIVE',
          target_count: 2,
          route_order_diff_count: 2,
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          id: 'schedule_2',
          pharmacist_id: 'pharmacist_1',
          scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
          version: 1,
        }),
        data: expect.objectContaining({
          route_order: 1,
          pharmacist_id: 'pharmacist_2',
          site_id: 'site_2',
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'visit_schedules_reordered',
          changes: expect.objectContaining({
            confirmation_context: {
              source: 'schedule_day_route_preview',
              date: '2026-04-09',
              pharmacist_id: 'pharmacist_1',
              travel_mode: 'DRIVE',
              target_count: 2,
              route_order_diff_count: 2,
            },
          }),
        }),
      }),
    );
  });

  it('applies a recommended vehicle assignment in the same guarded route transaction', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [
          { schedule_id: 'schedule_1', route_order: 1 },
          { schedule_id: 'schedule_2', route_order: 2 },
        ],
        vehicle_assignment: {
          mode: 'assign_if_unassigned',
          vehicle_resource_id: 'vehicle_1',
          schedule_ids: ['schedule_1', 'schedule_2'],
          expected_schedule_statuses: [
            { schedule_id: 'schedule_1', schedule_status: 'planned' },
            { schedule_id: 'schedule_2', schedule_status: 'planned' },
          ],
        },
        confirmation_context: {
          source: 'route_compare_adoption',
          date: '2026-04-09',
          pharmacist_id: 'pharmacist_1',
          target_count: 2,
          route_order_diff_count: 2,
          vehicle_assignment_count: 2,
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(vehicleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['vehicle_1'] },
        available: true,
      },
      select: {
        id: true,
        site_id: true,
        label: true,
        max_stops: true,
        max_route_duration_minutes: true,
        travel_mode: true,
        site: {
          select: {
            address: true,
            lat: true,
            lng: true,
          },
        },
      },
    });
    expect(scheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: { in: ['vehicle_1'] },
        scheduled_date: { in: [new Date('2026-04-09')] },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        id: { notIn: ['schedule_1', 'schedule_2'] },
      },
      select: {
        vehicle_resource_id: true,
        scheduled_date: true,
        route_order: true,
        time_window_start: true,
        case_: {
          select: {
            patient: {
              select: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(scheduleCountMock).not.toHaveBeenCalled();
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'schedule_1',
          schedule_status: 'planned',
          vehicle_resource_id: null,
        }),
        data: expect.objectContaining({
          route_order: 1,
          vehicle_resource_id: 'vehicle_1',
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'visit_schedules_reordered',
          changes: expect.objectContaining({
            vehicle_assignment: {
              mode: 'assign_if_unassigned',
              vehicle_resource_id: 'vehicle_1',
              schedule_ids: ['schedule_1', 'schedule_2'],
              expected_schedule_statuses: [
                { schedule_id: 'schedule_1', schedule_status: 'planned' },
                { schedule_id: 'schedule_2', schedule_status: 'planned' },
              ],
            },
            confirmation_context: expect.objectContaining({
              source: 'route_compare_adoption',
              vehicle_assignment_count: 2,
            }),
            updates: expect.arrayContaining([
              expect.objectContaining({
                schedule_id: 'schedule_1',
                route_order: 1,
                expected_schedule_status: 'planned',
                vehicle_resource_id: 'vehicle_1',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('rejects vehicle assignment when the reviewed schedule status is stale', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'ready',
        vehicle_resource_id: null,
        version: 1,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        vehicle_assignment: {
          mode: 'assign_if_unassigned',
          vehicle_resource_id: 'vehicle_1',
          schedule_ids: ['schedule_1'],
          expected_schedule_statuses: [{ schedule_id: 'schedule_1', schedule_status: 'planned' }],
        },
      }),
    ))!;

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '車両反映対象が同時に更新されました。再読み込みしてください',
    });
    expect(vehicleFindManyMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('applies a vehicle-only assignment without changing route order', async () => {
    const response = (await PATCH(
      createRequest({
        vehicle_assignment: {
          mode: 'assign_if_unassigned',
          vehicle_resource_id: 'vehicle_1',
          schedule_ids: ['schedule_1', 'schedule_2'],
        },
        confirmation_context: {
          source: 'schedule_day_route_preview',
          date: '2026-04-09',
          vehicle_assignment_count: 2,
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expect(scheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['schedule_1', 'schedule_2'] },
        }),
      }),
    );
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'schedule_1',
          vehicle_resource_id: null,
        }),
        data: expect.not.objectContaining({
          route_order: expect.any(Number),
        }),
      }),
    );
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vehicle_resource_id: 'vehicle_1',
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changes: expect.objectContaining({
            vehicle_assignment: {
              mode: 'assign_if_unassigned',
              vehicle_resource_id: 'vehicle_1',
              schedule_ids: ['schedule_1', 'schedule_2'],
            },
            updates: expect.arrayContaining([
              expect.objectContaining({
                schedule_id: 'schedule_1',
                route_order: undefined,
                vehicle_resource_id: 'vehicle_1',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('checks vehicle capacity for multiple cells with one batched read', async () => {
    authRoleRef.current = 'admin';

    const response = (await PATCH(
      createRequest({
        updates: [
          { schedule_id: 'schedule_1', route_order: 1, vehicle_resource_id: 'vehicle_1' },
          { schedule_id: 'schedule_3', route_order: 1, vehicle_resource_id: 'vehicle_2' },
        ],
      }),
    ))!;

    expect(response.status).toBe(200);
    const capacityReads = scheduleFindManyMock.mock.calls.filter(
      ([args]) => args.where.vehicle_resource_id,
    );
    expect(capacityReads).toHaveLength(1);
    expect(capacityReads[0]?.[0]).toEqual({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: { in: ['vehicle_1', 'vehicle_2'] },
        scheduled_date: { in: [new Date('2026-04-09'), new Date('2026-04-10')] },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        id: { notIn: ['schedule_1', 'schedule_3'] },
      },
      select: {
        vehicle_resource_id: true,
        scheduled_date: true,
        route_order: true,
        time_window_start: true,
        case_: {
          select: {
            patient: {
              select: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(scheduleCountMock).not.toHaveBeenCalled();
  });

  it('rejects route adoption when recommended vehicle capacity would be exceeded', async () => {
    vehicleFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '軽バン1号',
        max_stops: 2,
        max_route_duration_minutes: null,
        travel_mode: 'DRIVE',
        site: {
          address: '薬局',
          lat: 35.681236,
          lng: 139.767125,
        },
      },
    ]);
    scheduleFindManyMock.mockImplementation(({ where }: { where: { id?: { in?: string[] } } }) => {
      if (!where.id?.in) {
        return Promise.resolve([
          {
            id: 'schedule_existing',
            vehicle_resource_id: 'vehicle_1',
            scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
          },
        ]);
      }
      return Promise.resolve([
        {
          id: 'schedule_1',
          case_id: 'case_1',
          pharmacist_id: 'pharmacist_1',
          scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
          time_window_start: new Date('1970-01-01T09:00:00.000Z'),
          time_window_end: new Date('1970-01-01T10:00:00.000Z'),
          confirmed_at: null,
          route_order: 1,
          site_id: 'site_1',
          schedule_status: 'planned',
          vehicle_resource_id: null,
          version: 1,
        },
        {
          id: 'schedule_2',
          case_id: 'case_1',
          pharmacist_id: 'pharmacist_1',
          scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
          time_window_start: new Date('1970-01-01T10:00:00.000Z'),
          time_window_end: new Date('1970-01-01T11:00:00.000Z'),
          confirmed_at: null,
          route_order: 2,
          site_id: 'site_1',
          schedule_status: 'planned',
          vehicle_resource_id: null,
          version: 1,
        },
      ]);
    });

    const response = (await PATCH(
      createRequest({
        updates: [
          { schedule_id: 'schedule_1', route_order: 1 },
          { schedule_id: 'schedule_2', route_order: 2 },
        ],
        vehicle_assignment: {
          mode: 'assign_if_unassigned',
          vehicle_resource_id: 'vehicle_1',
          schedule_ids: ['schedule_1', 'schedule_2'],
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '軽バン1号 で訪問できる件数は最大 2 件です',
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects route adoption when recommended vehicle route duration would be exceeded', async () => {
    vehicleFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '軽バン1号',
        max_stops: 8,
        max_route_duration_minutes: 30,
        travel_mode: 'DRIVE',
        site: {
          address: '薬局',
          lat: 35.681236,
          lng: 139.767125,
        },
      },
    ]);
    scheduleFindManyMock.mockImplementation(
      ({
        where,
      }: {
        where: { id?: { in?: string[] }; vehicle_resource_id?: { in?: string[] } };
      }) => {
        if (where.vehicle_resource_id?.in) return Promise.resolve([]);
        return Promise.resolve([
          {
            id: 'schedule_1',
            case_id: 'case_1',
            pharmacist_id: 'pharmacist_1',
            scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
            time_window_start: new Date('1970-01-01T09:00:00.000Z'),
            time_window_end: new Date('1970-01-01T10:00:00.000Z'),
            confirmed_at: null,
            route_order: 1,
            site_id: 'site_1',
            schedule_status: 'planned',
            vehicle_resource_id: null,
            version: 1,
            case_: {
              patient: {
                residences: [
                  {
                    address: '近隣患者宅',
                    lat: 35.681236,
                    lng: 139.78,
                  },
                ],
              },
            },
          },
          {
            id: 'schedule_2',
            case_id: 'case_1',
            pharmacist_id: 'pharmacist_1',
            scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
            time_window_start: new Date('1970-01-01T10:00:00.000Z'),
            time_window_end: new Date('1970-01-01T11:00:00.000Z'),
            confirmed_at: null,
            route_order: 2,
            site_id: 'site_1',
            schedule_status: 'planned',
            vehicle_resource_id: null,
            version: 1,
            case_: {
              patient: {
                residences: [
                  {
                    address: '遠方患者宅',
                    lat: 35.681236,
                    lng: 139.95,
                  },
                ],
              },
            },
          },
        ]);
      },
    );

    const response = (await PATCH(
      createRequest({
        updates: [
          { schedule_id: 'schedule_1', route_order: 1 },
          { schedule_id: 'schedule_2', route_order: 2 },
        ],
        vehicle_assignment: {
          mode: 'assign_if_unassigned',
          vehicle_resource_id: 'vehicle_1',
          schedule_ids: ['schedule_1', 'schedule_2'],
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining('上限 30分を超えます'),
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects route order changes for already assigned vehicles when route duration would be exceeded', async () => {
    vehicleFindManyMock.mockResolvedValueOnce([
      {
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '軽バン1号',
        max_stops: 8,
        max_route_duration_minutes: 30,
        travel_mode: 'DRIVE',
        site: {
          address: '薬局',
          lat: 35.681236,
          lng: 139.767125,
        },
      },
    ]);
    scheduleFindManyMock.mockImplementation(
      ({
        where,
      }: {
        where: { id?: { in?: string[] }; vehicle_resource_id?: { in?: string[] } };
      }) => {
        if (where.vehicle_resource_id?.in) return Promise.resolve([]);
        return Promise.resolve([
          {
            id: 'schedule_1',
            case_id: 'case_1',
            pharmacist_id: 'pharmacist_1',
            scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
            time_window_start: null,
            time_window_end: null,
            confirmed_at: null,
            route_order: 2,
            site_id: 'site_1',
            schedule_status: 'planned',
            vehicle_resource_id: 'vehicle_1',
            version: 1,
            case_: {
              patient: {
                residences: [
                  {
                    address: '近隣患者宅',
                    lat: 35.681236,
                    lng: 139.78,
                  },
                ],
              },
            },
          },
          {
            id: 'schedule_2',
            case_id: 'case_1',
            pharmacist_id: 'pharmacist_1',
            scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
            time_window_start: null,
            time_window_end: null,
            confirmed_at: null,
            route_order: 1,
            site_id: 'site_1',
            schedule_status: 'planned',
            vehicle_resource_id: 'vehicle_1',
            version: 1,
            case_: {
              patient: {
                residences: [
                  {
                    address: '遠方患者宅',
                    lat: 35.681236,
                    lng: 139.95,
                  },
                ],
              },
            },
          },
        ]);
      },
    );

    const response = (await PATCH(
      createRequest({
        updates: [
          { schedule_id: 'schedule_1', route_order: 1 },
          { schedule_id: 'schedule_2', route_order: 2 },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining('上限 30分を超えます'),
    });
    expect(scheduleUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'schedule_1',
          vehicle_resource_id: 'vehicle_1',
        }),
      }),
    );
    expectNoWriteAuditOrNotify();
  });

  it('rejects route order changes for confirmed visits', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: new Date('2026-04-08T12:00:00.000Z'),
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 2 }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '電話確定済みの訪問予定は順路を変更できません',
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects route order changes for terminal visit statuses', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'completed',
        vehicle_resource_id: null,
        version: 1,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [{ schedule_id: 'schedule_1', route_order: 2 }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '完了済みまたは中止済みの訪問予定は順路を変更できません',
    });
    expectNoWriteAuditOrNotify();
  });

  it.each(['cancelled', 'rescheduled'] as const)(
    'rejects route order payloads for %s visits even when the route_order is unchanged',
    async (scheduleStatus) => {
      scheduleFindManyMock.mockResolvedValueOnce([
        {
          id: 'schedule_1',
          case_id: 'case_1',
          pharmacist_id: 'pharmacist_1',
          scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
          time_window_start: new Date('1970-01-01T09:00:00.000Z'),
          time_window_end: new Date('1970-01-01T10:00:00.000Z'),
          confirmed_at: null,
          route_order: 1,
          site_id: 'site_1',
          schedule_status: scheduleStatus,
          vehicle_resource_id: null,
          version: 1,
        },
      ]);

      const response = (await PATCH(
        createRequest({
          updates: [{ schedule_id: 'schedule_1', route_order: 1 }],
        }),
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '完了済みまたは中止済みの訪問予定は順路を変更できません',
      });
      expectNoWriteAuditOrNotify();
    },
  );

  it('rejects moving a schedule outside the target pharmacist shift', async () => {
    authRoleRef.current = 'admin';

    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        confirmed_at: null,
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
      },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      {
        site_id: 'site_2',
        user_id: 'pharmacist_2',
        date: new Date('2026-04-10T00:00:00.000Z'),
        available: true,
        available_from: new Date('1970-01-01T10:30:00.000Z'),
        available_to: new Date('1970-01-01T18:00:00.000Z'),
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
        route_order: 1,
        site_id: 'site_1',
        schedule_status: 'planned',
        vehicle_resource_id: null,
        version: 1,
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
