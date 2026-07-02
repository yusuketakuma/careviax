import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  facilityCountMock,
  facilityFindManyMock,
  residenceGroupByMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  facilityCountMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
  residenceGroupByMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    facility: {
      count: facilityCountMock,
      findMany: facilityFindManyMock,
    },
    residence: {
      groupBy: residenceGroupByMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: vi.fn(),
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(url: string) {
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/facilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    facilityCountMock.mockResolvedValue(1);
    facilityFindManyMock.mockResolvedValue([
      {
        id: 'fac_1',
        name: 'テスト施設',
        facility_type: 'nursing_home',
        address: '東京都千代田区',
        phone: null,
        fax: null,
        acceptance_time_from: null,
        acceptance_time_to: null,
        regular_visit_weekdays: [],
        notes: null,
        contacts: [],
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      },
    ]);
    residenceGroupByMock.mockResolvedValue([{ facility_id: 'fac_1', _count: { _all: 5 } }]);
  });

  it('returns 200 with facilities list', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/facilities'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].patient_count).toBe(5);
  });

  it('returns the minimal bounded search projection', async () => {
    facilityFindManyMock.mockResolvedValue([
      {
        id: 'fac_1',
        name: 'テスト施設',
        facility_type: 'nursing_home',
        address: '東京都千代田区',
        phone: '03-0000-0000',
        fax: '03-0000-0001',
        notes: 'search should not leak notes',
        contacts: [{ name: '担当者' }],
      },
    ]);

    const response = (await GET(
      createRequest('http://localhost/api/facilities?q=%E3%83%86%E3%82%B9%E3%83%88&limit=8'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expect(facilityFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          name: true,
          facility_type: true,
          address: true,
        },
        take: 9,
      }),
    );
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: 'fac_1',
          name: 'テスト施設',
          facility_type: 'nursing_home',
          address: '東京都千代田区',
          patient_count: 5,
        },
      ],
      hasMore: false,
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'facilities',
      filters_applied: {
        q: 'テスト',
      },
      limit: 8,
    });
    expect(body.data[0]).not.toHaveProperty('contacts');
    expect(body.data[0]).not.toHaveProperty('phone');
    expect(body.data[0]).not.toHaveProperty('fax');
    expect(body.data[0]).not.toHaveProperty('notes');
  });
});
