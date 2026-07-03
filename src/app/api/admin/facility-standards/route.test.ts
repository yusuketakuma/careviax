import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  facilityStandardFindManyMock,
  facilityStandardCountMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  facilityStandardFindManyMock: vi.fn(),
  facilityStandardCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    facilityStandardRegistration: {
      findMany: facilityStandardFindManyMock,
      count: facilityStandardCountMock,
    },
  },
}));

const emptyRouteContext = { params: Promise.resolve({}) };

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/facility-standards', { headers });
}

function createGetRequest(search = '', headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/admin/facility-standards${search}`, { headers });
}

describe('/api/admin/facility-standards GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityStandardCountMock.mockResolvedValue(0);
  });

  it('returns 403 when the role lacks admin permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), emptyRouteContext);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns facility standards for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    facilityStandardFindManyMock.mockResolvedValue([
      {
        id: 'std_1',
        standard_type: '地域連携薬局',
        filed_date: new Date('2026-01-01T00:00:00Z'),
        effective_date: new Date('2026-01-10T00:00:00Z'),
        expiry_date: new Date('2027-01-10T00:00:00Z'),
        renewal_alert_date: new Date('2026-10-10T00:00:00Z'),
        requirements_status: {
          training: true,
          staffing: false,
        },
        site: {
          id: 'site_1',
          name: '本店',
        },
      },
      {
        id: 'std_2',
        standard_type: '無菌製剤処理加算',
        filed_date: new Date('2026-02-01T00:00:00Z'),
        effective_date: null,
        expiry_date: null,
        renewal_alert_date: null,
        requirements_status: ['unexpected'],
        site: {
          id: 'site_1',
          name: '本店',
        },
      },
    ]);
    facilityStandardCountMock.mockResolvedValue(2);

    const response = await GET(
      createGetRequest('?limit=5', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'std_1',
          standard_type: '地域連携薬局',
          site_id: 'site_1',
          site_name: '本店',
          claim_status: 'blocked',
          requirements_status: {
            training: true,
            staffing: false,
          },
        }),
        expect.objectContaining({
          id: 'std_2',
          claim_status: 'unknown',
          requirements_status: null,
        }),
      ],
      total_count: 2,
      visible_count: 2,
      hidden_count: 0,
      truncated: false,
      count_basis: 'facility_standards',
      filters_applied: {},
      limit: 5,
    });
    expect(facilityStandardCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
      },
    });
    expect(facilityStandardFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
        },
        orderBy: [{ expiry_date: 'asc' }, { filed_date: 'desc' }],
        take: 5,
      }),
    );
  });

  it('returns counted metadata when the bounded list is truncated', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    facilityStandardCountMock.mockResolvedValue(3);
    facilityStandardFindManyMock.mockResolvedValue([
      {
        id: 'std_1',
        standard_type: '地域連携薬局',
        filed_date: new Date('2026-01-01T00:00:00Z'),
        effective_date: null,
        expiry_date: null,
        renewal_alert_date: null,
        requirements_status: {},
        site: {
          id: 'site_1',
          name: '本店',
        },
      },
    ]);

    const response = await GET(
      createGetRequest('?limit=1', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total_count: 3,
      visible_count: 1,
      hidden_count: 2,
      truncated: true,
      count_basis: 'facility_standards',
      filters_applied: {},
      limit: 1,
    });
  });

  it('treats an empty requirements_status ({}) as unknown, not claimable (no fail-open)', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    facilityStandardCountMock.mockResolvedValue(1);
    facilityStandardFindManyMock.mockResolvedValue([
      {
        id: 'std_empty',
        standard_type: '地域連携薬局',
        filed_date: new Date('2026-01-01T00:00:00Z'),
        effective_date: null,
        expiry_date: null,
        renewal_alert_date: null,
        // 要件が一件も検証・記録されていない状態
        requirements_status: {},
        site: {
          id: 'site_1',
          name: '本店',
        },
      },
    ]);

    const response = await GET(
      createGetRequest('?limit=5', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    // Object.values({}).every(Boolean) === true の vacuous truth に引きずられて
    // 'claimable' を返してはならない（未検証を算定可に見せる fail-open の禁止）。
    expect(body.data[0].claim_status).toBe('unknown');
    expect(body.data[0].claim_status).not.toBe('claimable');
    expect(body.data[0].requirements_status).toEqual({});
  });

  it('uses a default list bound and clamps overly large limits', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    facilityStandardFindManyMock.mockResolvedValue([]);

    const defaultResponse = await GET(
      createGetRequest('', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );
    if (!defaultResponse) throw new Error('defaultResponse is required');
    expect(defaultResponse.status).toBe(200);
    expect(facilityStandardFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 100,
      }),
    );

    const clampedResponse = await GET(
      createGetRequest('?limit=9999', { 'x-org-id': 'org_1' }),
      emptyRouteContext,
    );
    if (!clampedResponse) throw new Error('clampedResponse is required');
    expect(clampedResponse.status).toBe(200);
    expect(facilityStandardFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
  });
});
