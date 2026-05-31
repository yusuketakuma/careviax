import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const {
  pharmacistShiftFindManyMock,
  businessHolidayFindManyMock,
} = vi.hoisted(() => ({
  pharmacistShiftFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest(url: string): AuthenticatedTestRequest {
  return Object.assign(new NextRequest(url), {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
  });
}

describe('/api/pharmacist-shifts/available GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacistShiftFindManyMock.mockResolvedValue([
      {
        id: 'shift_1',
        site_id: 'site_1',
        user: {
          id: 'user_1',
          name: '佐藤',
          name_kana: 'サトウ',
        },
      },
      {
        id: 'shift_2',
        site_id: 'site_2',
        user: {
          id: 'user_2',
          name: '鈴木',
          name_kana: 'スズキ',
        },
      },
    ]);
    businessHolidayFindManyMock.mockResolvedValue([
      {
        site_id: 'site_2',
      },
    ]);
  });

  it('returns only shifts not blocked by site closures', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/pharmacist-shifts/available?date=2026-04-20&time_from=09:00:00&time_to=18:00:00',
      ),
    ))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        date: new Date('2026-04-20'),
        available: true,
        OR: [
          { available_to: null },
          { available_to: { gte: new Date('1970-01-01T18:00:00') } },
        ],
      },
      include: {
        user: { select: { id: true, name: true, name_kana: true } },
      },
      orderBy: { user: { name_kana: 'asc' } },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'shift_1',
        },
      ],
    });
  });
});
