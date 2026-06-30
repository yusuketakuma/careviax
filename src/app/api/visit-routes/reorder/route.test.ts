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
  scheduleUpdateManyMock,
  proposalFindManyMock,
  proposalFindFirstMock,
  proposalUpdateManyMock,
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
    scheduleUpdateManyMock: vi.fn(),
    proposalFindManyMock: vi.fn(),
    proposalFindFirstMock: vi.fn(),
    proposalUpdateManyMock: vi.fn(),
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

const emptyRouteContext = { params: Promise.resolve({}) };
const PATCH = (req: NextRequest) => rawPATCH(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-routes/reorder', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/visit-routes/reorder', {
    method: 'PATCH',
    body: '{',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function expectNoWriteAuditOrNotify() {
  expect(scheduleUpdateManyMock).not.toHaveBeenCalled();
  expect(proposalUpdateManyMock).not.toHaveBeenCalled();
  expect(auditLogCreateMock).not.toHaveBeenCalled();
  expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
}

function expectNoAuditOrNotify() {
  expect(auditLogCreateMock).not.toHaveBeenCalled();
  expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
}

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('/api/visit-routes/reorder PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRoleRef.current = 'pharmacist';
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockImplementation(() =>
      Promise.resolve({ role: authRoleRef.current }),
    );
    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        case_id: 'case_schedule',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
      },
    ]);
    proposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_1',
        case_id: 'case_proposal',
        proposed_date: new Date('2026-04-09T00:00:00.000Z'),
        proposed_pharmacist_id: 'user_1',
        finalized_schedule_id: null,
        proposal_status: 'patient_contact_pending',
      },
    ]);
    scheduleFindFirstMock.mockResolvedValue(null);
    proposalFindFirstMock.mockResolvedValue(null);
    scheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    proposalUpdateManyMock.mockResolvedValue({ count: 1 });
    auditLogCreateMock.mockResolvedValue({});
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: scheduleFindManyMock,
          findFirst: scheduleFindFirstMock,
          updateMany: scheduleUpdateManyMock,
        },
        visitScheduleProposal: {
          findMany: proposalFindManyMock,
          findFirst: proposalFindFirstMock,
          updateMany: proposalUpdateManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('requires visit permission before handling mixed route reorder mutations', async () => {
    authRoleRef.current = 'clerk';

    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '混在ルート順の更新権限がありません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('runs mixed reorder in a serializable org transaction', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('retries serializable route-order conflicts and succeeds on retry', async () => {
    withOrgContextMock.mockImplementationOnce(async () => {
      throw buildSerializableConflictError();
    });

    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
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

  it('returns conflict when serializable route-order conflicts exceed the retry limit', async () => {
    withOrgContextMock.mockImplementation(async () => {
      throw buildSerializableConflictError();
    });

    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
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

  it('atomically reorders mixed schedule and proposal route items with audit context', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [
          { item_type: 'proposal', id: 'proposal_1', route_order: 1 },
          { item_type: 'schedule', id: 'schedule_1', route_order: 2 },
        ],
        confirmation_context: {
          source: 'weekly_optimizer_mixed_route_preview',
          date: '2026-04-09',
          pharmacist_id: 'user_1',
          travel_mode: 'DRIVE',
          target_count: 2,
          route_order_diff_count: 2,
        },
      }),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(scheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        id: 'schedule_1',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
      }),
      data: {
        route_order: 2,
        version: { increment: 1 },
      },
    });
    expect(proposalUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org_1',
        id: 'proposal_1',
        proposed_pharmacist_id: 'user_1',
        proposed_date: new Date('2026-04-09T00:00:00.000Z'),
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
      }),
      data: { route_order: 1 },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'visit_routes_mixed_reordered',
          target_type: 'VisitRouteMixedCell',
          target_id: 'user_1:2026-04-09',
          changes: expect.objectContaining({
            date: '2026-04-09',
            pharmacist_id: 'user_1',
            schedule_updates: [
              expect.objectContaining({
                schedule_id: 'schedule_1',
                previous_route_order: null,
                route_order: 2,
              }),
            ],
            proposal_updates: [
              expect.objectContaining({
                proposal_id: 'proposal_1',
                previous_route_order: null,
                route_order: 1,
              }),
            ],
            confirmation_context: {
              source: 'weekly_optimizer_mixed_route_preview',
              date: '2026-04-09',
              pharmacist_id: 'user_1',
              travel_mode: 'DRIVE',
              target_count: 2,
              route_order_diff_count: 2,
            },
          }),
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(2);
  });

  it('rejects stale expected route_order before mixed route writes', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_schedule',
        pharmacist_id: 'user_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        route_order: 2,
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [
          {
            item_type: 'schedule',
            id: 'schedule_1',
            route_order: 1,
            expected_route_order: 1,
          },
        ],
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

  it('rejects arbitrary audit source text before writes', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
        confirmation_context: {
          source: 'patient-name-or-free-text',
        },
      }),
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expectNoWriteAuditOrNotify();
  });

  it('returns a sanitized no-store 500 when mixed reorder lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw route_order schedule_1 patient 山田 token secret');
    withOrgContextMock.mockRejectedValueOnce(unsafeError);

    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('raw route_order');
    expect(serialized).not.toContain('schedule_1');
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('token secret');
    expectNoWriteAuditOrNotify();
  });

  it('returns a sanitized no-store 500 when auth plumbing fails before parsing PATCH body', async () => {
    const unsafeError = new Error('raw auth route_order proposal_1 patient token secret');
    authMock.mockRejectedValueOnce(unsafeError);

    const response = (await PATCH(createMalformedJsonRequest()))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('raw auth');
    expect(serialized).not.toContain('proposal_1');
    expect(serialized).not.toContain('patient token secret');
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expectNoWriteAuditOrNotify();
  });

  it('returns conflict when a guarded schedule write loses the race', async () => {
    scheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expectNoAuditOrNotify();
  });

  it('returns conflict when a guarded proposal write loses the race', async () => {
    proposalUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'proposal', id: 'proposal_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
    });
    expectNoAuditOrNotify();
  });

  it('rejects duplicate route_order across schedules and proposals before writes', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [
          { item_type: 'schedule', id: 'schedule_1', route_order: 1 },
          { item_type: 'proposal', id: 'proposal_1', route_order: 1 },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同一セル内で route_order は重複できません',
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects mixed route schedule reorders when an already assigned vehicle would exceed route duration', async () => {
    scheduleFindManyMock.mockImplementation(
      ({
        where,
      }: {
        where: {
          id?: { in?: string[]; notIn?: string[] };
          vehicle_resource_id?: { in?: string[] };
        };
      }) => {
        if (where.vehicle_resource_id?.in) return Promise.resolve([]);
        return Promise.resolve([
          {
            id: 'schedule_1',
            case_id: 'case_schedule_1',
            pharmacist_id: 'user_1',
            scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
            route_order: 2,
            time_window_start: null,
            vehicle_resource_id: 'vehicle_1',
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
            vehicle_resource: {
              id: 'vehicle_1',
              label: '軽バン1号',
              max_route_duration_minutes: 30,
              travel_mode: 'DRIVE',
              site: {
                address: '薬局',
                lat: 35.681236,
                lng: 139.767125,
              },
            },
          },
          {
            id: 'schedule_2',
            case_id: 'case_schedule_2',
            pharmacist_id: 'user_1',
            scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
            route_order: 1,
            time_window_start: null,
            vehicle_resource_id: 'vehicle_1',
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
            vehicle_resource: {
              id: 'vehicle_1',
              label: '軽バン1号',
              max_route_duration_minutes: 30,
              travel_mode: 'DRIVE',
              site: {
                address: '薬局',
                lat: 35.681236,
                lng: 139.767125,
              },
            },
          },
        ]);
      },
    );

    const response = (await PATCH(
      createRequest({
        updates: [
          { item_type: 'schedule', id: 'schedule_1', route_order: 1 },
          { item_type: 'schedule', id: 'schedule_2', route_order: 2 },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining('上限 30分を超えます'),
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects locked proposals before partially updating schedules', async () => {
    proposalFindManyMock.mockResolvedValueOnce([
      {
        id: 'proposal_1',
        case_id: 'case_proposal',
        proposed_date: new Date('2026-04-09T00:00:00.000Z'),
        proposed_pharmacist_id: 'user_1',
        finalized_schedule_id: 'schedule_finalized',
        proposal_status: 'confirmed',
      },
    ]);

    const response = (await PATCH(
      createRequest({
        updates: [
          { item_type: 'schedule', id: 'schedule_1', route_order: 1 },
          { item_type: 'proposal', id: 'proposal_1', route_order: 2 },
        ],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '確定済みまたは却下済みの候補は並べ替えできません',
    });
    expectNoWriteAuditOrNotify();
  });

  it('rejects existing cross-table route_order conflicts before writes', async () => {
    proposalFindFirstMock.mockResolvedValueOnce({ id: 'proposal_existing' });

    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同一セル内で route_order は重複できません',
    });
    expectNoWriteAuditOrNotify();
  });
});
