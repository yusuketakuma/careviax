import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  getAuthAccessTokenMock,
  userFindUniqueMock,
  userUpdateMock,
  resolveLocalUserByIdentityMock,
  getUserMfaStateMock,
  updateCognitoUserProfileMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getAuthAccessTokenMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
  resolveLocalUserByIdentityMock: vi.fn(),
  getUserMfaStateMock: vi.fn(),
  updateCognitoUserProfileMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
  getAuthAccessToken: getAuthAccessTokenMock,
}));

vi.mock('@/lib/auth/user-resolution', () => ({
  resolveLocalUserByIdentity: resolveLocalUserByIdentityMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
      update: userUpdateMock,
    },
  },
}));

vi.mock('@/server/services/cognito-auth', () => ({
  getUserMfaState: getUserMfaStateMock,
}));

vi.mock('@/server/services/cognito-admin', () => ({
  updateCognitoUserProfile: updateCognitoUserProfileMock,
}));

import { GET, PATCH } from './route';

function createMalformedPatchRequest() {
  return new NextRequest('http://localhost/api/me/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"name":',
  });
}

describe('/api/me/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        id: 'user_1',
        email: 'user@example.com',
        cognitoSub: 'sub_1',
      },
    });
    getAuthAccessTokenMock.mockResolvedValue('token');
    userFindUniqueMock.mockResolvedValue({
      id: 'user_1',
      org_id: 'org_1',
      email: 'user@example.com',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      phone: '090-1111-2222',
      default_site_id: 'site_1',
      activated_at: new Date('2026-03-01T00:00:00.000Z'),
      memberships: [
        {
          role: 'admin',
          site: {
            id: 'site_1',
            name: '本店',
          },
        },
      ],
    });
    userUpdateMock.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      cognito_username: 'cognito-user',
      name: '更新後 名前',
      phone: '090-9999-0000',
    });
    getUserMfaStateMock.mockResolvedValue({ enabled: true });
    updateCognitoUserProfileMock.mockResolvedValue(undefined);
  });

  it('returns the current user profile with MFA state', async () => {
    const response = await GET(new NextRequest('http://localhost/api/me/profile'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'user_1',
        email: 'user@example.com',
        currentRole: 'admin',
        currentSiteName: '本店',
        mfaEnabled: true,
      },
    });
  });

  it('logs MFA state resolution failures without raw Cognito diagnostics', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getUserMfaStateMock.mockRejectedValueOnce(
      new Error('Cognito MFA failed patient=山田 token=secret-mfa-token'),
    );

    const response = await GET(new NextRequest('http://localhost/api/me/profile'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'user_1',
        mfaEnabled: false,
      },
    });
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'warn',
      message: 'me_profile.mfa_state_failed',
      event: 'me_profile.mfa_state_failed',
      route: '/api/me/profile',
      method: 'GET',
      operation: 'resolve_cognito_mfa_state',
      error_name: 'Error',
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('Cognito MFA failed');
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('secret-mfa-token');
    expect(serialized).not.toContain('user@example.com');
  });

  it('updates the current user profile and syncs Cognito', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/me/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: ' 更新後 名前 ',
          phone: ' 090-9999-0000 ',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        name: '更新後 名前',
        phone: '090-9999-0000',
      },
    });
    expect(updateCognitoUserProfileMock).toHaveBeenCalledWith({
      username: 'cognito-user',
      email: 'user@example.com',
      name: '更新後 名前',
      phone: '090-9999-0000',
    });
  });

  it('rejects non-object profile updates before local or Cognito mutation', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/me/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(['unexpected']),
      }),
    );

    expect(response.status).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(updateCognitoUserProfileMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before local or Cognito mutation', async () => {
    const response = await PATCH(createMalformedPatchRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(updateCognitoUserProfileMock).not.toHaveBeenCalled();
  });

  it('clears blank phone values before syncing Cognito', async () => {
    userUpdateMock.mockResolvedValueOnce({
      id: 'user_1',
      email: 'user@example.com',
      cognito_username: 'cognito-user',
      name: '更新後 名前',
      phone: null,
    });

    const response = await PATCH(
      new NextRequest('http://localhost/api/me/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: '更新後 名前',
          phone: '   ',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: {
        name: '更新後 名前',
        phone: null,
      },
    });
    expect(updateCognitoUserProfileMock).toHaveBeenCalledWith({
      username: 'cognito-user',
      email: 'user@example.com',
      name: '更新後 名前',
      phone: null,
    });
  });

  it('rejects malformed phone numbers before local or Cognito mutation', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/me/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: '更新後 名前',
          phone: '090-ABCD-1234',
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        phone: ['電話番号形式が不正です'],
      },
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(updateCognitoUserProfileMock).not.toHaveBeenCalled();
  });
});
