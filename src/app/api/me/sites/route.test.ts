import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  membershipFindManyMock,
  pharmacySiteFindManyMock,
  visitScheduleGroupByMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  pharmacySiteFindManyMock: vi.fn(),
  visitScheduleGroupByMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => async (req: NextRequest) => {
    const authResult = await requireAuthContextMock();
    if ('response' in authResult) return authResult.response;
    return handler(req, authResult.ctx, { params: Promise.resolve({}) });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: { findMany: membershipFindManyMock },
    pharmacySite: { findMany: pharmacySiteFindManyMock },
    visitSchedule: { groupBy: visitScheduleGroupByMock },
    user: { findUnique: userFindUniqueMock },
  },
}));

import { GET } from './route';

const routeCtx = { params: Promise.resolve({}) };

describe('/api/me/sites GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { userId: 'user_1', orgId: 'org_1', role: 'pharmacist' },
    });
    membershipFindManyMock.mockResolvedValue([{ site_id: 'site_1' }, { site_id: 'site_2' }]);
    pharmacySiteFindManyMock.mockResolvedValue([
      { id: 'site_1', name: '本店', is_regional_support: true },
      { id: 'site_2', name: '東部店', is_regional_support: false },
    ]);
    visitScheduleGroupByMock.mockResolvedValue([{ site_id: 'site_1', _count: { _all: 5 } }]);
    userFindUniqueMock.mockResolvedValue({ default_site_id: 'site_1' });
  });

  it('returns site list with visit counts and current flag', async () => {
    const response = await GET(new NextRequest('http://localhost/api/me/sites'), routeCtx);

    expect(response.status).toBe(200);
    expect(pharmacySiteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['site_1', 'site_2'] },
      },
      select: {
        id: true,
        name: true,
        is_regional_support: true,
      },
      orderBy: { name: 'asc' },
      take: 501,
    });
    expect(visitScheduleGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          site_id: { in: ['site_1', 'site_2'] },
        }),
      }),
    );
    const body = await response.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      id: 'site_1',
      name: '本店',
      todays_visit_count: 5,
      has_home_visit: true,
      is_current: true,
    });
    expect(body.data[1]).toMatchObject({
      id: 'site_2',
      name: '東部店',
      todays_visit_count: 0,
      has_home_visit: false,
      is_current: false,
    });
    expect(body.meta).toEqual({
      limit: 500,
      has_more: false,
    });
  });

  it('trims returned sites before deriving visit counts and reports has_more', async () => {
    pharmacySiteFindManyMock.mockResolvedValue([
      { id: 'site_1', name: '本店', is_regional_support: true },
      { id: 'site_2', name: '東部店', is_regional_support: false },
      { id: 'site_3', name: '北口店', is_regional_support: true },
    ]);
    visitScheduleGroupByMock.mockResolvedValue([
      { site_id: 'site_1', _count: { _all: 5 } },
      { site_id: 'site_3', _count: { _all: 9 } },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/me/sites?limit=2'), routeCtx);

    expect(response.status).toBe(200);
    expect(pharmacySiteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      }),
    );
    expect(visitScheduleGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          site_id: { in: ['site_1', 'site_2'] },
        }),
      }),
    );
    const body = await response.json();
    expect(body.data).toEqual([
      {
        id: 'site_1',
        name: '本店',
        todays_visit_count: 5,
        has_home_visit: true,
        is_current: true,
      },
      {
        id: 'site_2',
        name: '東部店',
        todays_visit_count: 0,
        has_home_visit: false,
        is_current: false,
      },
    ]);
    expect(body.meta).toEqual({
      limit: 2,
      has_more: true,
    });
  });

  it('returns all org sites when membership has a null site_id (universal access)', async () => {
    membershipFindManyMock.mockResolvedValue([{ site_id: null }]);

    await GET(new NextRequest('http://localhost/api/me/sites'), routeCtx);

    expect(pharmacySiteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ id: expect.anything() }),
        take: 501,
      }),
    );
  });

  it.each([
    ['9999', 501],
    ['0', 2],
    ['abc', 501],
  ])('bounds malformed or out-of-range limit "%s" to take %i', async (limit, expectedTake) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/me/sites?limit=${limit}`),
      routeCtx,
    );

    expect(response.status).toBe(200);
    expect(pharmacySiteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: expectedTake,
      }),
    );
  });

  it('sets is_current false when user has no default_site_id', async () => {
    userFindUniqueMock.mockResolvedValue({ default_site_id: null });

    const response = await GET(new NextRequest('http://localhost/api/me/sites'), routeCtx);
    const body = await response.json();

    expect(body.data.every((s: { is_current: boolean }) => !s.is_current)).toBe(true);
  });
});
