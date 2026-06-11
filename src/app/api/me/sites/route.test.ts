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
  withAuthContext: (handler: (...args: unknown[]) => unknown) =>
    async (req: NextRequest) => {
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
    visitScheduleGroupByMock.mockResolvedValue([
      { site_id: 'site_1', _count: { _all: 5 } },
    ]);
    userFindUniqueMock.mockResolvedValue({ default_site_id: 'site_1' });
  });

  it('returns site list with visit counts and current flag', async () => {
    const response = await GET(new NextRequest('http://localhost/api/me/sites'), routeCtx);

    expect(response.status).toBe(200);
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
  });

  it('returns all org sites when membership has a null site_id (universal access)', async () => {
    membershipFindManyMock.mockResolvedValue([{ site_id: null }]);

    await GET(new NextRequest('http://localhost/api/me/sites'), routeCtx);

    expect(pharmacySiteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ id: expect.anything() }),
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
