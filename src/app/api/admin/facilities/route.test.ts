import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, facilityFindManyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  facilityFindManyMock: vi.fn(),
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
  },
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    method: 'GET',
    nextUrl: new URL('http://localhost/api/admin/facilities'),
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/admin/facilities GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when the role lacks admin permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
  });

  it('returns facilities for pharmacists who can reference facility masters', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    facilityFindManyMock.mockResolvedValue([
      {
        id: 'facility_1',
        name: 'あおば苑',
        facility_type: 'nursing_home',
        address: '東京都新宿区1-1-1',
        phone: '03-1234-5678',
        fax: null,
        notes: null,
        created_at: new Date('2026-03-01T00:00:00Z'),
        updated_at: new Date('2026-03-02T00:00:00Z'),
        contacts: [
          {
            id: 'contact_1',
            name: '施設担当',
            role: '看護師長',
            phone: '03-0000-0000',
            email: 'facility@example.com',
            fax: null,
            is_primary: true,
            notes: null,
            created_at: new Date('2026-03-01T00:00:00Z'),
            updated_at: new Date('2026-03-02T00:00:00Z'),
          },
        ],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'facility_1',
          name: 'あおば苑',
          contacts: [expect.objectContaining({ name: '施設担当' })],
        }),
      ],
    });
  });
});
