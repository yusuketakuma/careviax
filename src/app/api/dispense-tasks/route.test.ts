import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  medicationCycleFindFirstMock,
  dispatchNotificationEventMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn((
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  }),
  withOrgContextMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      findFirst: medicationCycleFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/dispense-tasks POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      patient_id: 'patient_1',
      overall_status: 'ready_to_dispense',
      case_: {
        primary_pharmacist_id: 'pharmacist_1',
        patient: {
          name: '山田 太郎',
        },
      },
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
    const membershipFindManyMock = vi.fn().mockResolvedValue([
      { user_id: 'admin_1' },
      { user_id: 'pharmacist_1' },
    ]);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          create: createMock,
        },
        medicationCycle: {
          findFirst: vi.fn().mockResolvedValue({ id: 'cycle_1', overall_status: 'ready_to_dispense', version: 1 }),
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'cycle_1', overall_status: 'dispensing' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        membership: {
          findMany: membershipFindManyMock,
        },
      })
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        priority: 'emergency',
        due_date: '2026-03-29',
        assigned_to: 'user_urgent',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'dispense_task_emergency_created',
        type: 'urgent',
        link: '/dispensing/task_1',
        explicitUserIds: expect.arrayContaining(['user_urgent', 'pharmacist_1', 'admin_1']),
        dedupeKey: 'dispense-task-emergency:task_1',
      })
    );
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
          findFirst: vi.fn().mockResolvedValue({ id: 'cycle_1', overall_status: 'ready_to_dispense', version: 1 }),
          findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'cycle_1', overall_status: 'dispensing' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        membership: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      })
    );

    const response = await POST(
      createRequest({
        cycle_id: 'cycle_1',
        priority: 'normal',
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });
});
