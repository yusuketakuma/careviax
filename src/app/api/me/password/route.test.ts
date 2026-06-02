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

function createPasswordPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/me/password', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedPasswordPatchRequest() {
  return new NextRequest('http://localhost/api/me/password', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
}

describe('/api/me/password PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getAuthAccessTokenMock.mockResolvedValue('token');
    changePasswordWithAccessTokenMock.mockResolvedValue(undefined);
  });

  it('changes the password when the payload is valid', async () => {
    const response = await PATCH(
      createPasswordPatchRequest({
        currentPassword: 'old-password-value',
        newPassword: 'new-password-12345',
      }),
    );

    expect(response.status).toBe(200);
    expect(changePasswordWithAccessTokenMock).toHaveBeenCalledWith({
      accessToken: 'token',
      currentPassword: 'old-password-value',
      newPassword: 'new-password-12345',
    });
  });

  it('rejects non-object request bodies before Cognito password change', async () => {
    const response = await PATCH(createPasswordPatchRequest(['unexpected']));

    expect(response.status).toBe(400);
    expect(changePasswordWithAccessTokenMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before Cognito password change', async () => {
    const response = await PATCH(createMalformedPasswordPatchRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(changePasswordWithAccessTokenMock).not.toHaveBeenCalled();
  });
});
