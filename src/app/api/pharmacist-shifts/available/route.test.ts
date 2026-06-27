import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { pharmacistShiftFindManyMock, businessHolidayFindManyMock } = vi.hoisted(() => ({
  pharmacistShiftFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
  },
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

import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(url: string) {
  return new NextRequest(url);
}

function createShift(id: string, siteId: string) {
  return {
    id,
    site_id: siteId,
    user: {
      id: `user_${id}`,
      name: `薬剤師 ${id}`,
      name_kana: `ヤクザイシ ${id}`,
    },
  };
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
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
    expectSensitiveNoStore(response);
    expect(businessHolidayFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        date: new Date('2026-04-20'),
        is_closed: true,
      },
      select: {
        site_id: true,
      },
    });
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        date: new Date('2026-04-20'),
        available: true,
        site_id: { notIn: ['site_2'] },
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
      take: 501,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'shift_1',
        },
      ],
      meta: {
        limit: 500,
        has_more: false,
      },
    });
  });

  it('uses an explicit limit plus one for the shift query', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-04-20&limit=2'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        limit: 2,
        has_more: false,
      },
    });
  });

  it('excludes closed sites before take so open candidates can fill the limit', async () => {
    businessHolidayFindManyMock.mockResolvedValueOnce([
      {
        site_id: 'closed_site',
      },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      createShift('shift_open_1', 'open_site_1'),
      createShift('shift_open_2', 'open_site_2'),
      createShift('shift_open_3', 'open_site_3'),
    ]);

    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-04-20&limit=2'),
    ))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
    expect(pharmacistShiftFindManyMock.mock.calls[0]?.[0]?.where).toMatchObject({
      org_id: 'org_1',
      date: new Date('2026-04-20'),
      available: true,
      site_id: { notIn: ['closed_site'] },
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'shift_open_1' }, { id: 'shift_open_2' }],
      meta: {
        limit: 2,
        has_more: true,
      },
    });
  });

  it('returns empty data without querying shifts when the org is closed for the date', async () => {
    businessHolidayFindManyMock.mockResolvedValueOnce([{ site_id: null }]);

    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-04-20&limit=2'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      meta: {
        limit: 2,
        has_more: false,
      },
    });
  });

  it('trims overflowing filtered shift results and reports has_more', async () => {
    businessHolidayFindManyMock.mockResolvedValueOnce([]);
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      createShift('shift_1', 'site_1'),
      createShift('shift_2', 'site_2'),
      createShift('shift_3', 'site_3'),
    ]);

    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-04-20&limit=2'),
    ))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
    expect(pharmacistShiftFindManyMock.mock.calls[0]?.[0]?.where).toMatchObject({
      org_id: 'org_1',
      date: new Date('2026-04-20'),
      available: true,
    });
    expect(pharmacistShiftFindManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('site_id');
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'shift_1' }, { id: 'shift_2' }],
      meta: {
        limit: 2,
        has_more: true,
      },
    });
  });

  it.each([
    ['9999', 501],
    ['0', 2],
    ['abc', 501],
  ])('bounds malformed or out-of-range limit "%s" to take %i', async (limit, expectedTake) => {
    const response = (await GET(
      createRequest(
        `http://localhost/api/pharmacist-shifts/available?date=2026-04-20&limit=${limit}`,
      ),
    ))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
  });

  it('rejects missing or malformed date before querying shifts', async () => {
    const missingDateResponse = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available'),
    ))!;
    const invalidDateResponse = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-02-31'),
    ))!;

    expect(missingDateResponse.status).toBe(400);
    expectSensitiveNoStore(missingDateResponse);
    await expect(missingDateResponse.json()).resolves.toMatchObject({
      message: 'dateパラメータは必須です',
    });
    expect(invalidDateResponse.status).toBe(400);
    expectSensitiveNoStore(invalidDateResponse);
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
    expectSensitiveNoStore(malformedTimeResponse);
    await expect(malformedTimeResponse.json()).resolves.toMatchObject({
      message: '検索条件が不正です',
    });
    expect(reversedWindowResponse.status).toBe(400);
    expectSensitiveNoStore(reversedWindowResponse);
    await expect(reversedWindowResponse.json()).resolves.toMatchObject({
      message: '検索条件が不正です',
    });
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(businessHolidayFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw availability failures', async () => {
    businessHolidayFindManyMock.mockRejectedValueOnce(
      new Error('raw availability lookup failure for site_1'),
    );

    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shifts/available?date=2026-04-20'),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw availability lookup failure for site_1');
  });
});
