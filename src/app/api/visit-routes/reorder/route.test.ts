import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

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
    withAuthMock: vi.fn(
      (handler: (req: AuthenticatedTestRequest) => Promise<Response>, _options?: unknown) => {
        void _options;
        return (req: NextRequest) =>
          handler(
            Object.assign(req, {
              orgId: 'org_1',
              userId: 'user_1',
              role: authRoleRef.current,
            }),
          );
      },
    ),
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

const withAuthRegistrationCalls = [...withAuthMock.mock.calls];

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-routes/reorder', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
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

  it('requires visit permission before handling mixed route reorder mutations', () => {
    expect(withAuthRegistrationCalls[0]?.[1]).toMatchObject({
      permission: 'canVisit',
      message: '混在ルート順の更新権限がありません',
    });
  });

  it('runs mixed reorder in a serializable org transaction', async () => {
    const response = (await PATCH(
      createRequest({
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
      }),
    ))!;

    expect(response.status).toBe(200);
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
            schedule_updates: [{ schedule_id: 'schedule_1', route_order: 2 }],
            proposal_updates: [{ proposal_id: 'proposal_1', route_order: 1 }],
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
