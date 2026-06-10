import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';

const { getServerSessionMock, nextAuthMock, getTokenMock } = vi.hoisted(() => ({
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
import { resolveLocalUserByIdentity } from './user-resolution';

type SessionCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['session']>;
type JwtCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['jwt']>;

describe('authOptions jwt callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLocalUserByIdentity).mockResolvedValue(null);
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
    expect(token.offlineEncryptionSecret).toEqual(expect.any(String));
    expect(resolveLocalUserByIdentity).toHaveBeenCalledWith({
      cognitoSub: 'sub_1',
      email: 'user@example.com',
    });
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
        },
        expires: '2026-04-04T00:00:00.000Z',
      },
      token: {
        userId: 'user_1',
        cognitoSub: 'sub_1',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        offlineEncryptionSecret: 'offline-secret',
        cognitoGroups: ['admin'],
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
    expect(clientSession.cognitoGroups).toEqual(['admin']);
    expect(clientSession.phosRole).toBe('ADMIN');
    expect(clientSession.phosAccessToken).toBe('access-token');
    expect(clientSession.offlineEncryptionSecret).toBe('offline-secret');
    expect(clientSession).not.toHaveProperty('accessToken');
    expect(clientSession).not.toHaveProperty('refreshToken');
    expect(clientSession).not.toHaveProperty('idToken');
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
