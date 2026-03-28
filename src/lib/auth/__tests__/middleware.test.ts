import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getRequestAuthContext } from '../request-context';

const { authMock, membershipFindFirstMock, userFindUniqueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock('../config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

import { withAuth } from '../middleware';

function createRequest(orgId?: string) {
  return {
    headers: {
      get: (key: string) => (key === 'x-org-id' ? orgId ?? null : null),
    },
  } as unknown as NextRequest;
}

describe('withAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const handler = withAuth(async () => NextResponse.json({ ok: true }));

    const response = await handler(createRequest('org_1'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('returns 400 when org header is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    const handler = withAuth(async () => NextResponse.json({ ok: true }));

    const response = await handler(createRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('returns 403 when membership is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue(null);
    const handler = withAuth(async () => NextResponse.json({ ok: true }));

    const response = await handler(createRequest('org_1'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
  });

  it('returns 403 when role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'driver' });
    const handler = withAuth(async () => NextResponse.json({ ok: true }), {
      permission: 'canVisit',
      message: '権限がありません',
    });

    const response = await handler(createRequest('org_1'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
  });

  it('passes authenticated request to handler when permission check succeeds', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    const handler = withAuth(
      async (req) =>
        NextResponse.json({
          userId: req.userId,
          orgId: req.orgId,
          role: req.role,
        }),
      {
        permission: 'canAdmin',
      }
    );

    const response = await handler(createRequest('org_1'));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
  });

  it('exposes auth context inside the wrapped handler execution', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    const handler = withAuth(async () =>
      NextResponse.json({
        requestContext: getRequestAuthContext(),
      })
    );

    const response = await handler(
      createRequest('org_1')
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requestContext: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
  });
});
