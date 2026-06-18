import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type TestAuthContext = {
  orgId: string;
  userId: string;
  role: 'pharmacist';
};

type TestRouteContext = { params: Promise<Record<string, string>> };

const {
  withAuthContextMock,
  withOrgContextMock,
  medicationCycleFindFirstMock,
  dispenseTaskFindManyMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (handler: (req: NextRequest, ctx: TestAuthContext) => Promise<Response>) => {
      return (req: NextRequest) => {
        return handler(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        });
      };
    },
  ),
  withOrgContextMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      findFirst: medicationCycleFindFirstMock,
    },
    dispenseTask: {
      findMany: dispenseTaskFindManyMock,
    },
  },
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];
const emptyRouteContext: TestRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/dispense-tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/dispense-tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"cycle_id":',
  } satisfies NextRequestInit);
}

function createGetRequest(url = 'http://localhost/api/dispense-tasks') {
  return new NextRequest(url);
}

describe('/api/dispense-tasks GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispenseTaskFindManyMock.mockResolvedValue([]);
  });

  it('scopes collection reads to assigned medication cycles', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/dispense-tasks?status=pending&cycle_id=cycle_1'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        where: {
          org_id: 'org_1',
          status: 'pending',
          cycle_id: 'cycle_1',
        },
      }),
    );
  });
});

describe('/api/dispense-tasks POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      patient_id: 'patient_1',
      overall_status: 'ready_to_dispense',
      case_: {
        primary_pharmacist_id: 'pharmacist_1',
        backup_pharmacist_id: 'backup_1',
        patient: {
          name: '山田 太郎',
        },
      },
      visit_schedules: [{ pharmacist_id: 'schedule_pharmacist_1' }],
    });
  });

  it('dispatches an urgent in-app notification when an emergency dispense task is created', async () => {
    const createMock = vi.fn().mockResolvedValue({
      id: 'task_1',
      cycle_id: 'cycle_1',
      priority: 'emergency',
      cycle: {
        patient_id: 'patient_1',
        case_: {
          patient: {
            name: '山田 太郎',
          },
        },
      },
    });
    const membershipFindManyMock = vi
      .fn()
      .mockResolvedValue([{ user_id: 'admin_1' }, { user_id: 'owner_1' }]);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          create: createMock,
        },
        medicationCycle: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'ready_to_dispense', version: 1 }),
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'dispensing' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        membership: {
          findMany: membershipFindManyMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        priority: 'emergency',
        due_date: '2026-03-29',
        assigned_to: 'user_urgent',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(membershipFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ['owner', 'admin'] },
        }),
      }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'dispense_task_emergency_created',
        type: 'urgent',
        link: '/dispense?taskId=task_1',
        explicitUserIds: expect.arrayContaining([
          'pharmacist_1',
          'backup_1',
          'schedule_pharmacist_1',
          'admin_1',
          'owner_1',
        ]),
        dedupeKey: 'dispense-task-emergency:task_1',
      }),
    );
    const notificationInput = dispatchNotificationEventMock.mock.calls[0][1];
    expect(notificationInput.explicitUserIds).not.toContain('user_urgent');
    expect(notificationInput.explicitUserIds).not.toContain('unrelated_pharmacist_1');
    expect(notificationInput.metadata).toMatchObject({
      patient_id: 'patient_1',
      task_id: 'task_1',
    });
  });

  it('rejects non-object request bodies before cycle lookup or task creation', async () => {
    const response = await POST(createRequest(['unexpected']));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before cycle lookup or task creation', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });

  it('denies unassigned cycles before creating dispense tasks', async () => {
    medicationCycleFindFirstMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          create: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_unassigned',
        priority: 'urgent',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'cycle_unassigned',
        org_id: 'org_1',
      },
      select: {
        id: true,
        patient_id: true,
        overall_status: true,
        case_: {
          select: {
            primary_pharmacist_id: true,
            backup_pharmacist_id: true,
            patient: {
              select: {
                name: true,
              },
            },
          },
        },
        visit_schedules: {
          select: {
            pharmacist_id: true,
          },
        },
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });

  it('does not dispatch notifications for non-emergency dispense tasks', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          create: vi.fn().mockResolvedValue({
            id: 'task_2',
            cycle_id: 'cycle_1',
            priority: 'normal',
            cycle: {
              patient_id: 'patient_1',
              case_: {
                patient: {
                  name: '山田 太郎',
                },
              },
            },
          }),
        },
        medicationCycle: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'ready_to_dispense', version: 1 }),
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'dispensing' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        membership: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      }),
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        priority: 'normal',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });
});
