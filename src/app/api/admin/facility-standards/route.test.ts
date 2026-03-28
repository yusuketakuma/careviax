import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, facilityStandardFindManyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  facilityStandardFindManyMock: vi.fn(),
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
    },
  },
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/admin/facility-standards GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when the role lacks admin permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

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
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

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
      ],
    });
  });
});
