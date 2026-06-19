import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';

const { getMembershipMock, getServerSessionMock, nextAuthMock, getTokenMock } = vi.hoisted(() => ({
  getMembershipMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  nextAuthMock: vi.fn(() => vi.fn()),
  getTokenMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  default: nextAuthMock,
  getServerSession: getServerSessionMock,
}));

vi.mock('next-auth/jwt', () => ({
  getToken: getTokenMock,
}));

vi.mock('next-auth/providers/cognito', () => ({
  default: vi.fn(() => ({ id: 'cognito' })),
}));

vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn(() => ({ id: 'credentials' })),
}));

vi.mock('./context', () => ({
  getMembership: getMembershipMock,
}));

vi.mock('./user-resolution', () => ({
  markLocalUserActive: vi.fn(),
  resolveLocalUserByIdentity: vi.fn(),
}));

vi.mock('@/server/services/cognito-auth', () => ({
  authenticateWithPassword: vi.fn(),
  respondToNewPasswordChallenge: vi.fn(),
  respondToSoftwareTokenChallenge: vi.fn(),
}));

import { authOptions, getAuthAccessToken } from './config';
import { markLocalUserActive, resolveLocalUserByIdentity } from './user-resolution';

type SessionCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['session']>;
type JwtCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['jwt']>;

describe('authOptions jwt callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLocalUserByIdentity).mockResolvedValue(null);
    vi.mocked(markLocalUserActive).mockImplementation(async (user) => user);
    getMembershipMock.mockResolvedValue(null);
  });

  it('reads Cognito profile claims through the guarded profile object', async () => {
    const jwtCallback = authOptions.callbacks?.jwt;
    expect(jwtCallback).toBeTypeOf('function');
    const cognitoProfile = {
      sub: 'sub_1',
      email: 'user@example.com',
      'cognito:groups': ['admin', 'pharmacist'],
      role: 'MANAGER',
    } as unknown as Parameters<JwtCallback>[0]['profile'];

    const token = await jwtCallback!({
      token: {},
      account: {
        provider: 'cognito',
        type: 'oauth',
        providerAccountId: 'sub_1',
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
        id_token: 'oauth-id-token',
        expires_at: 1_900_000_000,
      },
      profile: cognitoProfile,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        emailVerified: null,
      },
      trigger: 'signIn',
      isNewUser: false,
    } satisfies Parameters<JwtCallback>[0]);

    expect(token.cognitoSub).toBe('sub_1');
    expect(token.sub).toBe('sub_1');
    expect(token.cognitoGroups).toEqual(['admin', 'pharmacist']);
    expect(token.phosRole).toBe('MANAGER');
    expect(token.accessToken).toBe('oauth-access-token');
    expect(token.accessTokenExpiry).toBe(1_900_000_000_000);
    expect(token).not.toHaveProperty('offlineEncryptionSecret');
    expect(resolveLocalUserByIdentity).toHaveBeenCalledWith({
      cognitoSub: 'sub_1',
      email: 'user@example.com',
    });
    expect(getMembershipMock).not.toHaveBeenCalled();
  });

  it('stores the current organization membership role in the JWT', async () => {
    const jwtCallback = authOptions.callbacks?.jwt;
    expect(jwtCallback).toBeTypeOf('function');
    getMembershipMock.mockResolvedValue({ role: 'pharmacist' });

    const token = await jwtCallback!({
      token: {
        userId: 'user_1',
        orgId: 'org_1',
      },
      account: null,
      profile: undefined,
      user: {
        id: 'user_1',
        email: 'user@example.com',
        emailVerified: null,
      },
      trigger: undefined,
      isNewUser: false,
    } satisfies Parameters<JwtCallback>[0]);

    expect(getMembershipMock).toHaveBeenCalledWith('user_1', 'org_1');
    expect(token.memberRole).toBe('pharmacist');
  });

  it('stores the local default site in the JWT for request actor context', async () => {
    const jwtCallback = authOptions.callbacks?.jwt;
    expect(jwtCallback).toBeTypeOf('function');
    const localUser = {
      id: 'user_1',
      org_id: 'org_1',
      cognito_sub: 'sub_1',
      email: 'user@example.com',
      name: 'PH-OS User',
      phone: null,
      default_site_id: 'site_1',
      is_active: true,
      account_status: 'active',
      activated_at: new Date('2026-06-01T00:00:00.000Z'),
      session_version: 4,
    } as const;
    vi.mocked(resolveLocalUserByIdentity).mockResolvedValue(localUser);
    vi.mocked(markLocalUserActive).mockResolvedValue(localUser);

    const token = await jwtCallback!({
      token: {},
      account: {
        provider: 'cognito',
        type: 'oauth',
        providerAccountId: 'sub_1',
        access_token: 'oauth-access-token',
      },
      profile: {
        sub: 'sub_1',
        email: 'user@example.com',
      } as Parameters<JwtCallback>[0]['profile'],
      user: {
        id: 'user_1',
        email: 'user@example.com',
        emailVerified: null,
      },
      trigger: 'signIn',
      isNewUser: false,
    } satisfies Parameters<JwtCallback>[0]);

    expect(token.orgId).toBe('org_1');
    expect(token.defaultSiteId).toBe('site_1');
    expect(token.sessionVersion).toBe(4);
  });
});

describe('authOptions session callback', () => {
  it('keeps refresh and ID tokens out of the client session payload', async () => {
    const sessionCallback = authOptions.callbacks?.session;
    expect(sessionCallback).toBeTypeOf('function');

    const session = await sessionCallback!({
      session: {
        user: {
          name: 'PH-OS User',
          email: 'user@example.com',
          role: null,
        },
        expires: '2026-04-04T00:00:00.000Z',
      },
      token: {
        userId: 'user_1',
        cognitoSub: 'sub_1',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        cognitoGroups: ['admin'],
        memberRole: 'pharmacist',
        phosRole: 'ADMIN',
      },
      user: {
        id: 'user_1',
        email: 'user@example.com',
        emailVerified: null,
      },
      newSession: null,
      trigger: 'update',
    } satisfies Parameters<SessionCallback>[0]);

    const clientSession = session as Session;

    expect(clientSession.user?.id).toBe('user_1');
    expect(clientSession.user?.cognitoSub).toBe('sub_1');
    expect(clientSession.user?.defaultSiteId).toBeNull();
    expect(clientSession.user?.role).toBe('pharmacist');
    expect(clientSession.cognitoGroups).toEqual(['admin']);
    expect(clientSession.phosRole).toBe('ADMIN');
    expect(clientSession).not.toHaveProperty('phosAccessToken');
    expect(clientSession).not.toHaveProperty('offlineEncryptionSecret');
    expect(clientSession).not.toHaveProperty('accessToken');
    expect(clientSession).not.toHaveProperty('refreshToken');
    expect(clientSession).not.toHaveProperty('idToken');
  });

  it('exposes defaultSiteId when it is present in the server JWT', async () => {
    const sessionCallback = authOptions.callbacks?.session;
    expect(sessionCallback).toBeTypeOf('function');

    const session = await sessionCallback!({
      session: {
        user: {
          name: 'PH-OS User',
          email: 'user@example.com',
          role: null,
        },
        expires: '2026-04-04T00:00:00.000Z',
      },
      token: {
        userId: 'user_1',
        orgId: 'org_1',
        defaultSiteId: 'site_1',
        memberRole: 'pharmacist',
      },
      user: {
        id: 'user_1',
        email: 'user@example.com',
        emailVerified: null,
      },
      newSession: null,
      trigger: 'update',
    } satisfies Parameters<SessionCallback>[0]);

    const clientSession = session as Session;

    expect(clientSession.user?.defaultSiteId).toBe('site_1');
  });
});

describe('getAuthAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the server-side access token from the JWT', async () => {
    getTokenMock.mockResolvedValue({ accessToken: 'jwt-access-token' });

    const request = new NextRequest('http://localhost/api/auth/session');
    await expect(getAuthAccessToken(request)).resolves.toBe('jwt-access-token');
    expect(getTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        req: request,
      }),
    );
  });
});
