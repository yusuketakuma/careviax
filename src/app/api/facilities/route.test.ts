import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  facilityFindManyMock,
  residenceGroupByMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
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
    residenceGroupByMock.mockResolvedValue([
      { facility_id: 'fac_1', _count: { _all: 5 } },
    ]);
  });

  it('returns 200 with facilities list', async () => {
    const response = (await GET(createRequest('http://localhost/api/facilities')))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].patient_count).toBe(5);
  });
});
