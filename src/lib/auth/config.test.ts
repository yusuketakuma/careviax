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

type SessionCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['session']>;

describe('authOptions session callback', () => {
  it('keeps Cognito tokens out of the client session payload', async () => {
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
        cognitoGroups: ['admin'],
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
      })
    );
  });
});
