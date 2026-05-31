import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitScheduleOverrideFindFirstMock,
  visitScheduleOverrideUpdateMock,
  visitScheduleUpdateMock,
  contactPartyFindManyMock,
  withOrgContextMock,
  dispatchNotificationEventMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitScheduleOverrideFindFirstMock: vi.fn(),
  visitScheduleOverrideUpdateMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  contactPartyFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
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

import { POST } from './route';

function createRequest() {
  return new NextRequest(
    'http://localhost/api/visit-schedules/schedule_1/reschedule/approve',
    { method: 'POST' },
  );
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
      source_schedule_id: 'schedule_1',
      source_schedule: {
        pharmacist_id: 'user_3',
        case_id: 'case_1',
        case_: { patient_id: 'patient_1' },
      },
    });
    visitScheduleOverrideUpdateMock.mockResolvedValue({
      id: 'override_1',
    });
    contactPartyFindManyMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitScheduleOverride: {
          update: visitScheduleOverrideUpdateMock,
        },
        visitSchedule: {
          update: visitScheduleUpdateMock,
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
    expect(visitScheduleOverrideUpdateMock).not.toHaveBeenCalled();
  });

  it('approves the override, resolves tasks, and dispatches a notification', async () => {
    const response = (await POST(createRequest(), {
      params: Promise.resolve({ id: 'schedule_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(visitScheduleOverrideUpdateMock).toHaveBeenCalled();
    expect(visitScheduleUpdateMock).toHaveBeenCalled();
    expect(resolveOperationalTasksMock).toHaveBeenCalledTimes(2);
    expect(dispatchNotificationEventMock).toHaveBeenCalled();
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
});
