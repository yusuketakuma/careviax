import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { clearRequestAuthContext } from '../request-context';

const { authMock, membershipFindFirstMock, userFindUniqueMock, logSecurityEventMock } =
  vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
    logSecurityEventMock: vi.fn(),
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

vi.mock('../security-events', () => ({
  logSecurityEvent: logSecurityEventMock,
}));

import { getAuthContext, requireAuthContext } from '../context';

const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('getAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue(null);
    clearRequestAuthContext();
  });

  it('returns null when the session is missing', async () => {
    authMock.mockResolvedValue(null);

    const result = await getAuthContext(createRequest({ 'x-org-id': 'org_1' }));

    expect(result).toBeNull();
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns null when org header is missing and no default org can be resolved', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });

    const result = await getAuthContext(createRequest());

    expect(result).toBeNull();
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
  });

  it('returns null when the user has no active membership for the org', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue(null);

    const result = await getAuthContext(createRequest({ 'x-org-id': 'org_1' }));

    expect(result).toBeNull();
    expect(membershipFindFirstMock).toHaveBeenCalledWith({
      where: { user_id: 'user_1', org_id: 'org_1', is_active: true },
      select: { role: true },
    });
  });

  it('returns user, org, and role when membership exists', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const result = await getAuthContext(createRequest({ 'x-org-id': 'org_1' }));

    expect(result).toEqual({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
  });
});

describe('requireAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue(null);
    clearRequestAuthContext();
  });

  afterEach(() => {
    process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
  });

  it('returns 401 when the session is missing', async () => {
    authMock.mockResolvedValue(null);

    const result = await requireAuthContext(createRequest({ 'x-org-id': 'org_1' }));

    expect('response' in result).toBe(true);
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_UNAUTHENTICATED',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'auth_failure',
        details: expect.objectContaining({ reason: 'no_user_identity' }),
      })
    );
  });

  it('returns 400 when org header is missing and no default org can be resolved', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });

    const result = await requireAuthContext(createRequest());

    expect('response' in result).toBe(true);
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_NO_ORG',
    });
  });

  it('falls back to the authenticated user org when the header is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    userFindUniqueMock.mockResolvedValue({ org_id: 'org_default' });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const result = await requireAuthContext(createRequest(), {
      permission: 'canVisit',
    });

    expect(result).toEqual({
      ctx: {
        userId: 'user_1',
        orgId: 'org_default',
        role: 'admin',
      },
    });
  });

  it('returns 403 when membership is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue(null);

    const result = await requireAuthContext(createRequest({ 'x-org-id': 'org_1' }));

    expect('response' in result).toBe(true);
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'unauthorized_access',
        details: expect.objectContaining({ reason: 'no_membership' }),
      })
    );
  });

  it('returns 403 when role lacks the requested permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const result = await requireAuthContext(createRequest({ 'x-org-id': 'org_1' }), {
      permission: 'canVisit',
      message: '閲覧権限がありません',
    });

    expect('response' in result).toBe(true);
    const response = 'response' in result ? result.response : undefined;
    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '閲覧権限がありません',
    });
    expect(logSecurityEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'unauthorized_access',
        details: expect.objectContaining({ reason: 'insufficient_permission' }),
      })
    );
  });

  it('returns auth context when permission check passes', async () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const result = await requireAuthContext(
      createRequest({
        'x-org-id': 'org_1',
        'x-forwarded-for': '203.0.113.10, 10.0.0.1',
        'user-agent': 'Vitest Browser',
      }),
      {
      permission: 'canVisit',
      }
    );

    expect(result).toEqual({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Browser',
      },
    });
  });

  it('falls back to the user default org when the header is missing', async () => {
    authMock.mockResolvedValue({ user: { email: 'user@example.com' } });
    userFindUniqueMock.mockResolvedValue({
      id: 'user_1',
      org_id: 'org_default',
      cognito_sub: 'sub_1',
      email: 'user@example.com',
      name: 'User',
      phone: null,
      default_site_id: null,
      is_active: true,
      account_status: 'active',
      activated_at: new Date('2026-03-01T00:00:00Z'),
    });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const result = await requireAuthContext(createRequest(), {
      permission: 'canVisit',
    });

    expect(result).toEqual({
      ctx: {
        userId: 'user_1',
        orgId: 'org_default',
        role: 'admin',
      },
    });
  });

});
