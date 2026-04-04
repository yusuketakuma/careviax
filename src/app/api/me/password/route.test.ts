import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, getAuthAccessTokenMock, changePasswordWithAccessTokenMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getAuthAccessTokenMock: vi.fn(),
  changePasswordWithAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
  getAuthAccessToken: getAuthAccessTokenMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  changePasswordWithAccessToken: changePasswordWithAccessTokenMock,
}));

import { PATCH } from './route';

describe('/api/me/password PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getAuthAccessTokenMock.mockResolvedValue('token');
    changePasswordWithAccessTokenMock.mockResolvedValue(undefined);
  });

  it('changes the password when the payload is valid', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/me/password', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'old-password-value',
          newPassword: 'new-password-12345',
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(changePasswordWithAccessTokenMock).toHaveBeenCalledWith({
      accessToken: 'token',
      currentPassword: 'old-password-value',
      newPassword: 'new-password-12345',
    });
  });
});
