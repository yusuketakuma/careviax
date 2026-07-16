import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getAuthAccessTokenMock, changePasswordAndRevokeSessionsMock } = vi.hoisted(() => ({
  getAuthAccessTokenMock: vi.fn(),
  changePasswordAndRevokeSessionsMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => (req: NextRequest) =>
    handler(req, {
      orgId: 'org_1',
      userId: 'user_1',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      requestId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
    }),
}));

vi.mock('@/lib/auth/config', () => ({
  getAuthAccessToken: getAuthAccessTokenMock,
}));

vi.mock('@/server/services/credential-revocation', () => ({
  changePasswordAndRevokeSessions: changePasswordAndRevokeSessionsMock,
  CredentialRevocationPendingError: class CredentialRevocationPendingError extends Error {},
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
    getAuthAccessTokenMock.mockResolvedValue('token');
    changePasswordAndRevokeSessionsMock.mockResolvedValue(undefined);
  });

  it('changes the password when the payload is valid', async () => {
    const response = await PATCH(
      createPasswordPatchRequest({
        currentPassword: 'old-password-value',
        newPassword: 'new-password-12345',
      }),
    );

    expect(response.status).toBe(200);
    expect(changePasswordAndRevokeSessionsMock).toHaveBeenCalledWith({
      userId: 'user_1',
      accessToken: 'token',
      currentPassword: 'old-password-value',
      newPassword: 'new-password-12345',
      actor: {
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        requestId: '11111111-1111-4111-8111-111111111111',
        correlationId: '22222222-2222-4222-8222-222222222222',
      },
    });
  });

  it('rejects non-object request bodies before Cognito password change', async () => {
    const response = await PATCH(createPasswordPatchRequest(['unexpected']));

    expect(response.status).toBe(400);
    expect(changePasswordAndRevokeSessionsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before Cognito password change', async () => {
    const response = await PATCH(createMalformedPasswordPatchRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(changePasswordAndRevokeSessionsMock).not.toHaveBeenCalled();
  });

  it('returns 400 only for a definitive current-password rejection', async () => {
    const error = new Error('wrong password');
    error.name = 'NotAuthorizedException';
    changePasswordAndRevokeSessionsMock.mockRejectedValueOnce(error);

    const response = await PATCH(
      createPasswordPatchRequest({
        currentPassword: 'wrong-password',
        newPassword: 'new-password-12345',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('returns 502 when provider or durable revocation completion is indeterminate', async () => {
    changePasswordAndRevokeSessionsMock.mockRejectedValueOnce(new Error('timeout'));

    const response = await PATCH(
      createPasswordPatchRequest({
        currentPassword: 'old-password-value',
        newPassword: 'new-password-12345',
      }),
    );

    expect(response.status).toBe(502);
  });
});
