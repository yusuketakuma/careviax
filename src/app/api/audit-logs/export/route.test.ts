import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, findManyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    auditLog: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    auditLog: {
      findMany: findManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest(
  headers?: Record<string, string>,
  search = 'format=csv'
) {
  const nextUrl = new URL(`http://localhost/api/audit-logs/export?${search}`);
  return {
    url: nextUrl.toString(),
    nextUrl,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/audit-logs/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([
      {
        id: 'audit_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'export',
        target_type: 'visit_record',
        target_id: 'visit_1',
        changes: { count: 1 },
        ip_address: '127.0.0.1',
        user_agent: 'vitest',
        created_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);
  });

  it('returns csv payload with UI-compatible filters', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest(
        { 'x-org-id': 'org_1' },
        'format=csv&actor=user_1&target_type=visit_record&date_from=2026-03-01&date_to=2026-03-31'
      )
    )) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actor_id: 'user_1',
          target_type: 'visit_record',
          created_at: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lte: new Date('2026-03-31T23:59:59.999Z'),
          },
        }),
      })
    );

    const body = await response.text();
    expect(body).toContain('"audit_1"');
    expect(body).toContain('"visit_record"');
  });

  it('returns json payload when requested', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest({ 'x-org-id': 'org_1' }, 'format=json')
    )) as Response;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: 'audit_1',
        action: 'export',
      }),
    ]);
  });
});
