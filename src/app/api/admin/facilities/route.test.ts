import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, facilityFindManyMock, residenceGroupByMock } = vi.hoisted(() => ({
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
    residenceGroupByMock.mockResolvedValue([
      {
        facility_id: 'facility_1',
        _count: {
          _all: 3,
        },
      },
    ]);
    facilityFindManyMock.mockResolvedValue([
      {
        id: 'facility_1',
        name: 'あおば苑',
        facility_type: 'nursing_home',
        address: '東京都新宿区1-1-1',
        phone: '03-1234-5678',
        fax: null,
        acceptance_time_from: new Date('1970-01-01T09:00:00.000Z'),
        acceptance_time_to: new Date('1970-01-01T17:00:00.000Z'),
        regular_visit_weekdays: [1, 3, 5],
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
          acceptance_time_from: '09:00',
          acceptance_time_to: '17:00',
          patient_count: 3,
          contacts: [expect.objectContaining({ name: '施設担当' })],
        }),
      ],
    });
  });
});
