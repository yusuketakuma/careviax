import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { pharmacySiteFindManyMock } = vi.hoisted(() => ({
  pharmacySiteFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacySite: {
      findMany: pharmacySiteFindManyMock,
    },
  },
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const routeGET = (req: NextRequest) => GET(req, emptyRouteContext);

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('/api/pharmacy-sites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a basic site list by default', async () => {
    pharmacySiteFindManyMock.mockResolvedValue([
      {
        id: 'site_1',
        name: '本店',
        address: '東京都千代田区',
        phone: '03-0000-0000',
        fax: '03-0000-0001',
        lat: 35.0,
        lng: 139.0,
        is_health_support_pharmacy: true,
        is_regional_support: false,
        is_specialized_pharmacy: true,
        dispensing_fee_category: 'basic_1',
      },
    ]);

    const response = (await routeGET(new NextRequest('http://localhost/api/pharmacy-sites')))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'site_1',
          name: '本店',
          fax: '03-0000-0001',
          is_health_support_pharmacy: true,
          is_specialized_pharmacy: true,
          dispensing_fee_category: 'basic_1',
        },
      ],
    });
  });

  it('returns resource-map capability summaries when view=resource_map', async () => {
    pharmacySiteFindManyMock.mockResolvedValue([
      {
        id: 'site_1',
        name: '本店',
        address: '東京都千代田区',
        phone: '03-0000-0000',
        lat: 35.0,
        lng: 139.0,
        is_health_support_pharmacy: true,
        is_regional_support: true,
        facility_standards: [{ standard_type: '麻薬小売業' }],
        pharmacist_shifts: [
          {
            date: new Date('2026-03-30T00:00:00.000Z'),
            available: true,
            user: {
              can_accept_emergency: true,
              visit_specialties: ['無菌調剤'],
            },
          },
        ],
        business_holidays: [],
      },
    ]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/pharmacy-sites?view=resource_map'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'site_1',
          supports_narcotic: true,
          supports_sterile: true,
        }),
      ],
      summary: expect.objectContaining({
        total_sites: 1,
      }),
    });
  });

  it('uses the Japan business date for resource-map shift and holiday windows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T15:30:00.000Z'));
    pharmacySiteFindManyMock.mockResolvedValue([]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/pharmacy-sites?view=resource_map'),
    ))!;

    expect(response.status).toBe(200);
    expect(pharmacySiteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          pharmacist_shifts: expect.objectContaining({
            where: {
              date: {
                gte: new Date('2026-07-01T00:00:00.000Z'),
              },
            },
          }),
          business_holidays: expect.objectContaining({
            where: {
              is_closed: true,
              date: {
                gte: new Date('2026-07-01T00:00:00.000Z'),
              },
            },
          }),
        }),
      }),
    );
  });

  it('matches holiday emergency coverage by local calendar date', async () => {
    pharmacySiteFindManyMock.mockResolvedValue([
      {
        id: 'site_1',
        name: '本店',
        address: '東京都千代田区',
        phone: '03-0000-0000',
        lat: 35.0,
        lng: 139.0,
        is_health_support_pharmacy: true,
        is_regional_support: false,
        facility_standards: [],
        pharmacist_shifts: [
          {
            date: new Date(2026, 3, 9, 13, 0, 0),
            available: true,
            user: {
              can_accept_emergency: true,
              visit_specialties: [],
            },
          },
        ],
        business_holidays: [
          {
            id: 'holiday_1',
            date: new Date(2026, 3, 9, 0, 0, 0),
            name: '臨時休業',
          },
        ],
      },
    ]);

    const response = (await routeGET(
      new NextRequest('http://localhost/api/pharmacy-sites?view=resource_map'),
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'site_1',
          emergency_capable_shift_count: 1,
          holiday_gap_dates: [],
        }),
      ],
      summary: expect.objectContaining({
        holiday_gap_sites: 0,
      }),
    });
  });

  it('returns a no-store fixed error without leaking raw site lookup failures', async () => {
    pharmacySiteFindManyMock.mockRejectedValueOnce(
      new Error('raw pharmacy site lookup failure for org_1'),
    );

    const response = (await routeGET(new NextRequest('http://localhost/api/pharmacy-sites')))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw pharmacy site lookup failure for org_1');
  });
});
