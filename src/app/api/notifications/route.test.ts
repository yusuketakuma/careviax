import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  getMembershipMock,
  findManyMock,
  updateManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getMembershipMock: vi.fn(),
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/auth/context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/context')>(
    '@/lib/auth/context'
  );
  return {
    ...actual,
    getMembership: getMembershipMock,
  };
});

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET } from './route';

function createRequest(url: string, headers?: Record<string, string>) {
  return {
    url,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/notifications GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    updateManyMock.mockResolvedValue({ count: 0 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        notification: {
          findMany: findManyMock,
          updateMany: updateManyMock,
        },
      })
    );
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/notifications', { 'x-org-id': 'org_1' })
    );

    expect(response.status).toBe(401);
  });

  it('returns 403 when a non-admin requests another user notifications', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getMembershipMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await GET(
      createRequest(
        'http://localhost/api/notifications?user_id=user_2',
        { 'x-org-id': 'org_1' }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 200 when an admin requests another user notifications', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getMembershipMock.mockResolvedValue({ role: 'admin' });

    const response = await GET(
      createRequest(
        'http://localhost/api/notifications?user_id=user_2',
        { 'x-org-id': 'org_1' }
      )
    );

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledOnce();
  });
});
