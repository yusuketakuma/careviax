import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';

type TestAuthContext = {
  orgId: string;
  userId: string;
  role: MemberRole;
};

type TestRouteContext = { params: Promise<Record<string, string>> };

const {
  authContextMock,
  withAuthContextMock,
  withOrgContextMock,
  medicationCycleFindFirstMock,
  dispenseTaskFindManyMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  authContextMock: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist' as MemberRole,
  },
  withAuthContextMock: vi.fn(
    (handler: (req: NextRequest, ctx: TestAuthContext) => Promise<Response>) => {
      return (req: NextRequest) => handler(req, authContextMock);
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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/dispense-tasks GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.role = 'pharmacist';
    dispenseTaskFindManyMock.mockResolvedValue([]);
  });

  it('scopes collection reads to assigned medication cycles', async () => {
    const response = await GET(
      createGetRequest(
        'http://localhost/api/dispense-tasks?status=pending&cycle_id=cycle_1&assigned_to=user_1',
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        where: {
          org_id: 'org_1',
          status: 'pending',
          cycle_id: 'cycle_1',
          assigned_to: 'user_1',
        },
      }),
    );
  });

  it('allows dispense-capable trainee roles to read assigned medication-cycle tasks', async () => {
    authContextMock.role = 'pharmacist_trainee';

    const response = await GET(
      createGetRequest('http://localhost/api/dispense-tasks?cycle_id=cycle_trainee'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle_id: 'cycle_trainee',
        },
      }),
    );
  });

  it('allows clerk roles to read medication-cycle tasks through report read-all permission', async () => {
    authContextMock.role = 'clerk';

    const response = await GET(
      createGetRequest('http://localhost/api/dispense-tasks?cycle_id=cycle_clerk'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle_id: 'cycle_clerk',
        },
      }),
    );
  });

  it('keeps cursor pagination shape and Prisma cursor semantics stable', async () => {
    dispenseTaskFindManyMock.mockResolvedValue([
      { id: 'task_1', cycle_id: 'cycle_1', status: 'pending' },
      { id: 'task_2', cycle_id: 'cycle_1', status: 'pending' },
    ]);

    const response = await GET(
      createGetRequest('http://localhost/api/dispense-tasks?limit=1&cursor=task_0'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        cursor: { id: 'task_0' },
        skip: 1,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'task_1' }],
      hasMore: true,
      nextCursor: 'task_1',
    });
  });

  it.each(['driver', 'external_viewer'] as const)(
    'forbids %s before reading dispense tasks',
    async (role) => {
      authContextMock.role = role;

      const response = await GET(
        createGetRequest('http://localhost/api/dispense-tasks?cycle_id=cycle_1'),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(403);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: '調剤タスクの閲覧権限がありません',
      });
      expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'duplicate status',
      'http://localhost/api/dispense-tasks?status=pending&status=completed',
      { status: ['status は1つだけ指定してください'] },
    ],
    [
      'blank cycle_id',
      'http://localhost/api/dispense-tasks?cycle_id=',
      { cycle_id: ['サイクルIDを指定してください'] },
    ],
    [
      'padded assigned_to',
      'http://localhost/api/dispense-tasks?assigned_to=%20user_1',
      { assigned_to: ['担当者IDの形式が不正です'] },
    ],
  ])(
    'rejects malformed %s filters before reading dispense tasks',
    async (_caseName, url, details) => {
      const response = await GET(createGetRequest(url));

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        message: '検索条件が不正です',
        details,
      });
      expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported status filters before reading dispense tasks', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/dispense-tasks?status=cancelled'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤タスクステータスが不正です',
      details: {
        status: ['対応していないステータスです'],
      },
    });
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
  });
});

describe('/api/dispense-tasks POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextMock.role = 'pharmacist';
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
    const taskId = '../task with space?x=1#secret';
    const createMock = vi.fn().mockResolvedValue({
      id: taskId,
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
        link: '/dispense?taskId=..%2Ftask%20with%20space%3Fx%3D1%23secret',
        explicitUserIds: expect.arrayContaining([
          'pharmacist_1',
          'backup_1',
          'schedule_pharmacist_1',
          'admin_1',
          'owner_1',
        ]),
        dedupeKey: `dispense-task-emergency:${taskId}`,
      }),
    );
    const notificationInput = dispatchNotificationEventMock.mock.calls[0][1];
    expect(notificationInput.link).not.toContain('/task?');
    expect(notificationInput.link).not.toContain('+');
    expect(notificationInput.link).not.toContain('#secret');
    expect(notificationInput.explicitUserIds).not.toContain('user_urgent');
    expect(notificationInput.explicitUserIds).not.toContain('unrelated_pharmacist_1');
    expect(notificationInput.metadata).toMatchObject({
      patient_id: 'patient_1',
      task_id: taskId,
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
