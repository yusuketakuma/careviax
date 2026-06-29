import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, resolveLocalUserByIdentityMock, visitRecordCountMock, visitScheduleCountMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    resolveLocalUserByIdentityMock: vi.fn(),
    visitRecordCountMock: vi.fn(),
    visitScheduleCountMock: vi.fn(),
  }));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/auth/user-resolution', () => ({
  resolveLocalUserByIdentity: resolveLocalUserByIdentityMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: {
      count: visitRecordCountMock,
    },
    visitSchedule: {
      count: visitScheduleCountMock,
    },
  },
}));

import { GET } from './route';

describe('/api/me/activity-summary GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        id: 'user_1',
      },
    });
    visitRecordCountMock.mockResolvedValueOnce(12).mockResolvedValueOnce(7);
    visitScheduleCountMock.mockResolvedValueOnce(3).mockResolvedValueOnce(9);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns aggregated activity counts for the current user', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        currentMonthVisitCount: 12,
        last30DaysVisitCount: 7,
        todayAssignedCount: 3,
        upcomingAssignedCount: 9,
      },
    });
  });

  it('uses Japan business month/day ranges for visit and schedule counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T15:30:00.000Z')); // 2026-07-01 00:30 JST

    const response = await GET();

    expect(response.status).toBe(200);
    expect(visitRecordCountMock).toHaveBeenNthCalledWith(1, {
      where: {
        pharmacist_id: 'user_1',
        visit_date: {
          gte: new Date('2026-06-30T15:00:00.000Z'),
          lt: new Date('2026-07-31T15:00:00.000Z'),
        },
      },
    });
    expect(visitScheduleCountMock).toHaveBeenNthCalledWith(1, {
      where: {
        pharmacist_id: 'user_1',
        scheduled_date: {
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lt: new Date('2026-07-02T00:00:00.000Z'),
        },
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
    });
    expect(visitScheduleCountMock).toHaveBeenNthCalledWith(2, {
      where: {
        pharmacist_id: 'user_1',
        scheduled_date: {
          gte: new Date('2026-07-02T00:00:00.000Z'),
          lt: new Date('2026-08-01T00:00:00.000Z'),
        },
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
    });
  });
});
