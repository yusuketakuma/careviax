import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, findManyMock, countMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    auditLog: {
      findMany: findManyMock,
      count: countMock,
    },
  },
}));

import { GET } from './route';

function createRequest(
  headers?: Record<string, string>,
  search = 'limit=10'
) {
  const url = new URL(`http://localhost/api/audit-logs?${search}`);
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    nextUrl: {
      searchParams: url.searchParams,
    },
  } as unknown as NextRequest;
}

describe('/api/audit-logs GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = (await GET(createRequest())) as Response;

    expect(response.status).toBe(401);
  });

  it('returns 403 when the role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' })
    )) as Response;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 200 when the role has permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' })
    )) as Response;

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledOnce();
    expect(countMock).toHaveBeenCalledOnce();
  });

  it('supports UI filter parameter names and inclusive date ranges', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest(
        { 'x-org-id': 'org_1' },
        'actor=user_99&target_type=visit_record&action=export&date_from=2026-03-01&date_to=2026-03-31'
      )
    )) as Response;

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          actor_id: 'user_99',
          target_type: 'visit_record',
          action: 'export',
          created_at: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lte: new Date('2026-03-31T23:59:59.999Z'),
          },
        }),
      })
    );
  });
});
