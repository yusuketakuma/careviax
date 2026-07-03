import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlatformOperatorRole, PlatformOperatorStatus } from '@prisma/client';

vi.mock('server-only', () => ({}));

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
const { resolveLocalUserByIdentityMock } = vi.hoisted(() => ({
  resolveLocalUserByIdentityMock: vi.fn(),
}));
const { getClientIpMock } = vi.hoisted(() => ({ getClientIpMock: vi.fn() }));
const { unauthorizedMock, forbiddenResponseMock } = vi.hoisted(() => ({
  unauthorizedMock: vi.fn(async () => ({ status: 401 })),
  forbiddenResponseMock: vi.fn(async () => ({ status: 403 })),
}));
const { platformOperatorFindUnique, userFindUnique } = vi.hoisted(() => ({
  platformOperatorFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: authMock }));
vi.mock('@/lib/auth/user-resolution', () => ({
  resolveLocalUserByIdentity: resolveLocalUserByIdentityMock,
}));
vi.mock('@/lib/api/request-ip', () => ({ getClientIp: getClientIpMock }));
vi.mock('@/lib/api/response', () => ({
  unauthorized: unauthorizedMock,
  forbiddenResponse: forbiddenResponseMock,
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    platformOperator: { findUnique: platformOperatorFindUnique },
    user: { findUnique: userFindUnique },
  },
}));

import {
  resolvePlatformOperator,
  requirePlatformOperator,
  platformRoleAtLeast,
} from './operator';

function fakeRequest() {
  return {
    headers: { get: (k: string) => (k === 'user-agent' ? 'vitest-ua' : null) },
    nextUrl: { pathname: '/api/platform/x' },
  } as never;
}

/**
 * Wire the two prisma.user.findUnique call sites (id-resolution vs email lookup)
 * onto a single mock keyed by the requested `select`.
 */
function wireUserFindUnique(opts: { id?: string | null; email?: string | null }) {
  userFindUnique.mockImplementation(async ({ select }: { select?: Record<string, boolean> }) => {
    if (select?.email) return opts.email === undefined ? null : { email: opts.email };
    if (select?.id) return opts.id === undefined || opts.id === null ? null : { id: opts.id };
    return null;
  });
}

describe('resolvePlatformOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientIpMock.mockReturnValue('203.0.113.5');
  });

  it('(a) returns null when auth() is null', async () => {
    authMock.mockResolvedValue(null);
    await expect(resolvePlatformOperator(fakeRequest())).resolves.toBeNull();
    expect(platformOperatorFindUnique).not.toHaveBeenCalled();
  });

  it('(b) returns null when the user resolves but has no platformOperator', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1', email: 'op@example.com' } });
    wireUserFindUnique({ id: 'user_1', email: 'op@example.com' });
    platformOperatorFindUnique.mockResolvedValue(null);
    await expect(resolvePlatformOperator(fakeRequest())).resolves.toBeNull();
  });

  it('(c) returns null when the operator is suspended', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1', email: 'op@example.com' } });
    wireUserFindUnique({ id: 'user_1', email: 'op@example.com' });
    platformOperatorFindUnique.mockResolvedValue({
      id: 'op_1',
      role: PlatformOperatorRole.platform_admin,
      status: PlatformOperatorStatus.suspended,
    });
    await expect(resolvePlatformOperator(fakeRequest())).resolves.toBeNull();
  });

  it('(d) returns null when the resolved user has no email', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    wireUserFindUnique({ id: 'user_1', email: null });
    platformOperatorFindUnique.mockResolvedValue({
      id: 'op_1',
      role: PlatformOperatorRole.platform_support,
      status: PlatformOperatorStatus.active,
    });
    await expect(resolvePlatformOperator(fakeRequest())).resolves.toBeNull();
  });

  it('(e) returns the operator context with ip/ua from the request for an active operator', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1', email: 'op@example.com' } });
    wireUserFindUnique({ id: 'user_1', email: 'op@example.com' });
    platformOperatorFindUnique.mockResolvedValue({
      id: 'op_1',
      role: PlatformOperatorRole.platform_owner,
      status: PlatformOperatorStatus.active,
    });

    await expect(resolvePlatformOperator(fakeRequest())).resolves.toEqual({
      operatorId: 'op_1',
      userId: 'user_1',
      email: 'op@example.com',
      role: PlatformOperatorRole.platform_owner,
      ipAddress: '203.0.113.5',
      userAgent: 'vitest-ua',
    });
  });

  it('falls back to identity resolution when the session has no direct user id', async () => {
    authMock.mockResolvedValue({ user: { cognitoSub: 'sub_1', email: 'op@example.com' } });
    resolveLocalUserByIdentityMock.mockResolvedValue({ id: 'user_9' });
    wireUserFindUnique({ id: 'user_9', email: 'op@example.com' });
    platformOperatorFindUnique.mockResolvedValue({
      id: 'op_9',
      role: PlatformOperatorRole.platform_admin,
      status: PlatformOperatorStatus.active,
    });

    const result = await resolvePlatformOperator(fakeRequest());
    expect(result?.userId).toBe('user_9');
    expect(resolveLocalUserByIdentityMock).toHaveBeenCalled();
  });
});

describe('requirePlatformOperator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientIpMock.mockReturnValue('203.0.113.5');
  });

  it('(a) returns a 401 response for a non-operator', async () => {
    authMock.mockResolvedValue(null);
    const result = await requirePlatformOperator(fakeRequest());
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect((result.response as unknown as { status: number }).status).toBe(401);
    }
    expect(unauthorizedMock).toHaveBeenCalledTimes(1);
  });

  it('(b) returns a 403 response when the operator lacks the required role', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1', email: 'op@example.com' } });
    wireUserFindUnique({ id: 'user_1', email: 'op@example.com' });
    platformOperatorFindUnique.mockResolvedValue({
      id: 'op_1',
      role: PlatformOperatorRole.platform_support,
      status: PlatformOperatorStatus.active,
    });

    const result = await requirePlatformOperator(fakeRequest(), {
      minRole: PlatformOperatorRole.platform_owner,
    });
    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect((result.response as unknown as { status: number }).status).toBe(403);
    }
    expect(forbiddenResponseMock).toHaveBeenCalledTimes(1);
  });

  it('(c) returns the operator when the minimum role is satisfied', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1', email: 'op@example.com' } });
    wireUserFindUnique({ id: 'user_1', email: 'op@example.com' });
    platformOperatorFindUnique.mockResolvedValue({
      id: 'op_1',
      role: PlatformOperatorRole.platform_owner,
      status: PlatformOperatorStatus.active,
    });

    const result = await requirePlatformOperator(fakeRequest(), {
      minRole: PlatformOperatorRole.platform_admin,
    });
    expect('operator' in result).toBe(true);
    if ('operator' in result) {
      expect(result.operator.operatorId).toBe('op_1');
      expect(result.operator.role).toBe(PlatformOperatorRole.platform_owner);
    }
    expect(forbiddenResponseMock).not.toHaveBeenCalled();
  });
});

describe('platformRoleAtLeast', () => {
  const support = PlatformOperatorRole.platform_support;
  const admin = PlatformOperatorRole.platform_admin;
  const owner = PlatformOperatorRole.platform_owner;

  it('treats support < admin < owner for every pair', () => {
    // reflexive
    expect(platformRoleAtLeast(support, support)).toBe(true);
    expect(platformRoleAtLeast(admin, admin)).toBe(true);
    expect(platformRoleAtLeast(owner, owner)).toBe(true);

    // higher satisfies lower
    expect(platformRoleAtLeast(admin, support)).toBe(true);
    expect(platformRoleAtLeast(owner, support)).toBe(true);
    expect(platformRoleAtLeast(owner, admin)).toBe(true);

    // lower does NOT satisfy higher
    expect(platformRoleAtLeast(support, admin)).toBe(false);
    expect(platformRoleAtLeast(support, owner)).toBe(false);
    expect(platformRoleAtLeast(admin, owner)).toBe(false);
  });
});
