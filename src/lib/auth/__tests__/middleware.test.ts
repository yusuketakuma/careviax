import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const { authMock, getMembershipMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getMembershipMock: vi.fn(),
}));

vi.mock('../config', () => ({
  auth: authMock,
}));

vi.mock('../context', async () => {
  const actual = await vi.importActual<typeof import('../context')>('../context');
  return {
    ...actual,
    getMembership: getMembershipMock,
  };
});

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
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const handler = withAuth(async () => NextResponse.json({ ok: true }));

    const response = await handler(createRequest('org_1'));

    expect(response.status).toBe(401);
  });

  it('returns 400 when org header is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    const handler = withAuth(async () => NextResponse.json({ ok: true }));

    const response = await handler(createRequest());

    expect(response.status).toBe(400);
  });

  it('returns 403 when membership is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getMembershipMock.mockResolvedValue(null);
    const handler = withAuth(async () => NextResponse.json({ ok: true }));

    const response = await handler(createRequest('org_1'));

    expect(response.status).toBe(403);
  });

  it('returns 403 when role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getMembershipMock.mockResolvedValue({ role: 'driver' });
    const handler = withAuth(async () => NextResponse.json({ ok: true }), {
      permission: 'canVisit',
      message: '権限がありません',
    });

    const response = await handler(createRequest('org_1'));

    expect(response.status).toBe(403);
  });

  it('passes authenticated request to handler when permission check succeeds', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getMembershipMock.mockResolvedValue({ role: 'admin' });
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

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
  });
});
