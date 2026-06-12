import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, externalProfessionalFindManyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  externalProfessionalFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    externalProfessional: {
      findMany: externalProfessionalFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: vi.fn(),
}));

vi.mock('@/lib/patient/facility-reference', () => ({
  assertFacilityReference: vi.fn(),
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

function createRequest(url: string) {
  return new NextRequest(url, {
    method: 'GET',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/external-professionals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    externalProfessionalFindManyMock.mockResolvedValue([
      {
        id: 'ep_1',
        profession_type: 'doctor',
        name: '田中医師',
        facility_id: null,
        facility: null,
        organization_name: 'テスト病院',
        department: null,
        phone: null,
        email: null,
        fax: null,
        preferred_contact_method: null,
        preferred_contact_time: null,
        last_contacted_at: null,
        last_success_channel: null,
        address: null,
        notes: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
        _count: { care_team_links: 3 },
      },
    ]);
  });

  it('returns 200 with external professionals list', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/external-professionals'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].patient_count).toBe(3);
  });
});
