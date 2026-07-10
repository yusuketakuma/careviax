import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { requirePlatformOperatorMock, organizationFindManyMock, listActiveSessionsMock } =
  vi.hoisted(() => ({
    requirePlatformOperatorMock: vi.fn(),
    organizationFindManyMock: vi.fn(),
    listActiveSessionsMock: vi.fn(),
  }));

vi.mock('@/lib/platform/operator', () => ({
  requirePlatformOperator: requirePlatformOperatorMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findMany: organizationFindManyMock,
    },
  },
}));

vi.mock('@/lib/platform/break-glass', () => ({
  listActiveBreakGlassSessions: listActiveSessionsMock,
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const operator = {
  operatorId: 'operator_1',
  userId: 'user_1',
  email: 'operator@example.invalid',
  role: 'platform_operator',
};

function createRequest() {
  return new NextRequest('http://localhost/api/platform/tenants');
}

describe('GET /api/platform/tenants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformOperatorMock.mockResolvedValue({ operator });
    organizationFindManyMock.mockResolvedValue([
      {
        id: 'org_1',
        name: 'さくら薬局',
        corporate_number: '1234567890123',
        created_at: new Date('2026-07-01T00:00:00.000Z'),
        _count: { memberships: 5, sites: 2 },
      },
      {
        id: 'org_2',
        name: 'ひまわり薬局',
        corporate_number: null,
        created_at: new Date('2026-07-02T00:00:00.000Z'),
        _count: { memberships: 3, sites: 1 },
      },
    ]);
    listActiveSessionsMock.mockResolvedValue([
      {
        id: 'bg_1',
        target_org_id: 'org_2',
        expires_at: new Date('2026-07-10T08:00:00.000Z'),
        scope: 'read_only',
      },
    ]);
  });

  it('does not query tenants or sessions when the platform guard rejects the request', async () => {
    requirePlatformOperatorMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    expect(organizationFindManyMock).not.toHaveBeenCalled();
    expect(listActiveSessionsMock).not.toHaveBeenCalled();
  });

  it('returns bounded tenant metadata and operator-owned access state in an exact data envelope', async () => {
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(organizationFindManyMock).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        corporate_number: true,
        created_at: true,
        _count: { select: { memberships: true, sites: true } },
      },
      orderBy: { name: 'asc' },
      take: 500,
    });
    expect(listActiveSessionsMock).toHaveBeenCalledWith('operator_1');
    await expect(response.json()).resolves.toEqual({
      data: {
        tenants: [
          {
            id: 'org_1',
            name: 'さくら薬局',
            corporate_number: '1234567890123',
            created_at: '2026-07-01T00:00:00.000Z',
            member_count: 5,
            site_count: 2,
            active_break_glass: null,
          },
          {
            id: 'org_2',
            name: 'ひまわり薬局',
            corporate_number: null,
            created_at: '2026-07-02T00:00:00.000Z',
            member_count: 3,
            site_count: 1,
            active_break_glass: {
              id: 'bg_1',
              expires_at: '2026-07-10T08:00:00.000Z',
              scope: 'read_only',
            },
          },
        ],
      },
    });
  });
});
