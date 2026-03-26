import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, getMembershipMock, countMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getMembershipMock: vi.fn(),
  countMock: vi.fn(),
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

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitSchedule: {
      count: countMock,
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

describe('/api/dashboard/today GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countMock
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    expect(response.status).toBe(401);
  });

  it('returns 403 when the role lacks dashboard permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getMembershipMock.mockResolvedValue({ role: 'driver' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 200 when the role has dashboard permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getMembershipMock.mockResolvedValue({ role: 'clerk' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    expect(response.status).toBe(200);
    expect(countMock).toHaveBeenCalledTimes(5);
  });
});
