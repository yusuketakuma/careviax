import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { pharmacySiteFindManyMock } = vi.hoisted(() => ({
  pharmacySiteFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (req: NextRequest & { orgId: string }) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({ ...req, orgId: 'org_1' } as NextRequest & { orgId: string });
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
        lat: 35.0,
        lng: 139.0,
      },
    ]);

    const response = (await GET({
      url: 'http://localhost/api/pharmacy-sites',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'site_1', name: '本店' }],
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

    const response = (await GET({
      url: 'http://localhost/api/pharmacy-sites?view=resource_map',
    } as NextRequest))!;

    expect(response.status).toBe(200);
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
});
