import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const { pharmacistShiftFindManyMock, businessHolidayFindManyMock } = vi.hoisted(() => ({
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

  it('returns only shifts not blocked by site closures with normalized time bounds', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/pharmacist-shifts/available?date=%202026-04-20%20&time_from=%2009:00%20&time_to=%2018:00:00%20',
      ),
    ))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        date: new Date('2026-04-20'),
        available: true,
        AND: [
          {
            OR: [
              { available_from: null },
              { available_from: { lte: new Date('1970-01-01T09:00') } },
            ],
          },
          {
            OR: [
              { available_to: null },
              { available_to: { gte: new Date('1970-01-01T18:00:00') } },
            ],
          },
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

  it('rejects missing or malformed date before querying shifts', async () => {
    const missingDateResponse = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available'),
    ))!;
    const invalidDateResponse = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-02-31'),
    ))!;

    expect(missingDateResponse.status).toBe(400);
    await expect(missingDateResponse.json()).resolves.toMatchObject({
      message: 'dateパラメータは必須です',
    });
    expect(invalidDateResponse.status).toBe(400);
    await expect(invalidDateResponse.json()).resolves.toMatchObject({
      message: '検索条件が不正です',
    });
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(businessHolidayFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed or reversed time windows before querying shifts', async () => {
    const malformedTimeResponse = (await GET(
      createRequest(
        'http://localhost/api/pharmacist-shifts/available?date=2026-04-20&time_from=24:00',
      ),
    ))!;
    const reversedWindowResponse = (await GET(
      createRequest(
        'http://localhost/api/pharmacist-shifts/available?date=2026-04-20&time_from=18:00&time_to=09:00',
      ),
    ))!;

    expect(malformedTimeResponse.status).toBe(400);
    await expect(malformedTimeResponse.json()).resolves.toMatchObject({
      message: '検索条件が不正です',
    });
    expect(reversedWindowResponse.status).toBe(400);
    await expect(reversedWindowResponse.json()).resolves.toMatchObject({
      message: '検索条件が不正です',
    });
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(businessHolidayFindManyMock).not.toHaveBeenCalled();
  });
});
