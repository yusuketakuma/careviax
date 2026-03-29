import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authMock,
  resolveLocalUserByIdentityMock,
  visitRecordCountMock,
  visitScheduleCountMock,
} = vi.hoisted(() => ({
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
});
