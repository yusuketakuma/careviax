import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitScheduleOverrideFindFirstMock,
  visitScheduleOverrideUpdateManyMock,
  visitScheduleUpdateMock,
  contactPartyFindManyMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
  resolveOperationalTasksMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitScheduleOverrideFindFirstMock: vi.fn(),
  visitScheduleOverrideUpdateManyMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  contactPartyFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitScheduleOverride: {
      findFirst: visitScheduleOverrideFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/visit-schedules/schedule_1/reschedule/approve', {
    method: 'POST',
  });
}

describe('/api/visit-schedules/[id]/reschedule/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'admin_1',
        role: 'admin',
      },
    });
    visitScheduleOverrideFindFirstMock.mockResolvedValue({
      id: 'override_1',
      requested_by: 'user_2',
      approved_at: null,
      status: 'pending',
      source_schedule_id: 'schedule_1',
      source_schedule: {
        pharmacist_id: 'user_3',
        case_id: 'case_1',
        case_: { patient_id: 'patient_1' },
      },
    });
    visitScheduleOverrideUpdateManyMock.mockResolvedValue({ count: 1 });
    visitScheduleUpdateMock.mockResolvedValue({ count: 1 });
    contactPartyFindManyMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitScheduleOverride: {
          updateMany: visitScheduleOverrideUpdateManyMock,
        },
        visitSchedule: {
          updateMany: visitScheduleUpdateMock,
        },
        contactParty: {
          findMany: contactPartyFindManyMock,
        },
      }),
    );
  });

  it('rejects self approval for reschedule requests', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_2',
        role: 'admin',
      },
    });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'schedule_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(visitScheduleOverrideUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank schedule ids before loading override requests', async () => {
    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleOverrideFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(contactPartyFindManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('does not approve completed or cancelled override requests', async () => {
    visitScheduleOverrideFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'schedule_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(visitScheduleOverrideFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          source_schedule_id: 'schedule_1',
          status: 'pending',
        },
      }),
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleOverrideUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(contactPartyFindManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('approves the override, resolves tasks, and dispatches a notification', async () => {
    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'schedule_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(visitScheduleOverrideUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'override_1',
        org_id: 'org_1',
        status: 'pending',
        approved_at: null,
      },
      data: {
        approved_by: 'admin_1',
        approved_at: expect.any(Date),
      },
    });
    expect(visitScheduleUpdateMock).toHaveBeenCalled();
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'schedule_1',
        org_id: 'org_1',
        schedule_status: { notIn: ['completed', 'cancelled', 'rescheduled'] },
      },
      data: {
        schedule_status: 'rescheduled',
        version: { increment: 1 },
      },
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledTimes(2);
    expect(dispatchNotificationEventMock).toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'visit_schedules_reschedule_approve', schedule_id: 'schedule_1' },
    });
    expect(contactPartyFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        is_emergency_contact: true,
      },
      select: {
        id: true,
        name: true,
        relation: true,
        phone: true,
        email: true,
        fax: true,
        is_primary: true,
        organization_name: true,
        notes: true,
      },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    });
  });

  it('returns conflict without side effects when another approver wins the pending claim race', async () => {
    visitScheduleOverrideUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'schedule_1' }),
    }))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'リスケ承認が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleOverrideUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(contactPartyFindManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict and skips side effects when the source schedule is already terminal', async () => {
    visitScheduleUpdateMock.mockResolvedValueOnce({ count: 0 });

    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'schedule_1' }),
    }))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'リスケ承認が同時に更新されました。再読み込みしてください',
    });
    expect(visitScheduleOverrideUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'schedule_1',
        org_id: 'org_1',
        schedule_status: { notIn: ['completed', 'cancelled', 'rescheduled'] },
      },
      data: {
        schedule_status: 'rescheduled',
        version: { increment: 1 },
      },
    });
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(contactPartyFindManyMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
