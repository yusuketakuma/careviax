import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, changePasswordWithAccessTokenMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  changePasswordWithAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  changePasswordWithAccessToken: changePasswordWithAccessTokenMock,
}));

import { PATCH } from './route';

describe('/api/me/password PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      accessToken: 'token',
    });
    changePasswordWithAccessTokenMock.mockResolvedValue(undefined);
  });

  it('changes the password when the payload is valid', async () => {
    const response = await PATCH({
      json: async () => ({
        currentPassword: 'old-password-value',
        newPassword: 'new-password-12345',
      }),
    } as Request);

    expect(response.status).toBe(200);
    expect(changePasswordWithAccessTokenMock).toHaveBeenCalledWith({
      accessToken: 'token',
      currentPassword: 'old-password-value',
      newPassword: 'new-password-12345',
    });
  });
});
