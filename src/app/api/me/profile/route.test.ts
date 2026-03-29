import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authMock,
  userFindUniqueMock,
  userUpdateMock,
  resolveLocalUserByIdentityMock,
  getUserMfaStateMock,
  updateCognitoUserProfileMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
  resolveLocalUserByIdentityMock: vi.fn(),
  getUserMfaStateMock: vi.fn(),
  updateCognitoUserProfileMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
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

describe('/api/me/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      accessToken: 'token',
      user: {
        id: 'user_1',
        email: 'user@example.com',
        cognitoSub: 'sub_1',
      },
    });
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
    const response = await GET();

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

  it('updates the current user profile and syncs Cognito', async () => {
    const response = await PATCH({
      json: async () => ({
        name: '更新後 名前',
        phone: '090-9999-0000',
      }),
    } as Request);

    expect(response.status).toBe(200);
    expect(updateCognitoUserProfileMock).toHaveBeenCalledWith({
      username: 'cognito-user',
      email: 'user@example.com',
      name: '更新後 名前',
      phone: '090-9999-0000',
    });
  });
});
