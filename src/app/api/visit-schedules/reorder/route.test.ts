import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  scheduleFindManyMock,
  scheduleUpdateMock,
  membershipFindManyMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    }
  ),
  withOrgContextMock: vi.fn(),
  scheduleFindManyMock: vi.fn(),
  scheduleUpdateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/visit-schedules/reorder PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        confirmed_at: null,
      },
      {
        id: 'schedule_2',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
        confirmed_at: null,
      },
    ]);
    membershipFindManyMock.mockResolvedValue([{ user_id: 'pharmacist_2' }]);
    scheduleUpdateMock.mockResolvedValue({});
    auditLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: scheduleFindManyMock,
          update: scheduleUpdateMock,
        },
        membership: {
          findMany: membershipFindManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      })
    );
  });

  it('updates multiple schedules in one batch', async () => {
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
      })
    ))!;

    expect(response.status).toBe(200);
    expect(scheduleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'schedule_2' },
        data: expect.objectContaining({
          route_order: 1,
          pharmacist_id: 'pharmacist_2',
        }),
      })
    );
  });

  it('rejects moving a confirmed schedule to another day or pharmacist', async () => {
    scheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'schedule_1',
        case_id: 'case_1',
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-09T00:00:00.000Z'),
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
      })
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
