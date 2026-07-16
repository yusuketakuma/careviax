import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmForgotPasswordAndRevokeSessionsMock } = vi.hoisted(() => ({
  confirmForgotPasswordAndRevokeSessionsMock: vi.fn(),
}));

vi.mock('@/server/services/credential-revocation', () => ({
  confirmForgotPasswordAndRevokeSessions: confirmForgotPasswordAndRevokeSessionsMock,
  CredentialRevocationPendingError: class CredentialRevocationPendingError extends Error {},
}));

vi.mock('@/lib/api/rate-limit', () => ({
  checkAuthRateLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 }),
}));

import { POST } from './route';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';

function createRequest(body: unknown) {
  return new Request('http://localhost/api/auth/password/reset/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedRequest() {
  return new Request('http://localhost/api/auth/password/reset/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

describe('/api/auth/password/reset/confirm POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmForgotPasswordAndRevokeSessionsMock.mockResolvedValue(undefined);
    vi.mocked(checkAuthRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60000,
    });
  });

  it('confirms password reset for a valid payload', async () => {
    const response = await POST(
      createRequest({
        email: 'user@example.com',
        code: '123456',
        newPassword: 'New-Password-12345!',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { ok: true } });
    expect(confirmForgotPasswordAndRevokeSessionsMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      code: '123456',
      newPassword: 'New-Password-12345!',
      actor: { ipAddress: null, userAgent: undefined },
    });
  });

  it('trims surrounding whitespace before confirming the password reset', async () => {
    const response = await POST(
      createRequest({
        email: ' user@example.com ',
        code: ' 123456 ',
        newPassword: ' New-Password-12345! ',
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: { ok: true } });
    expect(body).not.toHaveProperty('ok');
    expect(confirmForgotPasswordAndRevokeSessionsMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      code: '123456',
      newPassword: 'New-Password-12345!',
      actor: { ipAddress: null, userAgent: undefined },
    });
  });

  it('rejects non-object JSON payloads before confirming the password reset', async () => {
    const response = await POST(createRequest([]));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(confirmForgotPasswordAndRevokeSessionsMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads before confirming the password reset', async () => {
    const response = await POST(createMalformedRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(confirmForgotPasswordAndRevokeSessionsMock).not.toHaveBeenCalled();
  });

  it('returns a client error when the confirmation code is incorrect', async () => {
    const error = new Error('mismatch');
    error.name = 'CodeMismatchException';
    confirmForgotPasswordAndRevokeSessionsMock.mockRejectedValueOnce(error);

    const response = await POST(
      createRequest({
        email: 'user@example.com',
        code: '123456',
        newPassword: 'New-Password-12345!',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
      message: '確認コードが正しくありません',
    });
  });

  it('returns a provider error when Cognito fails for a server-side reason', async () => {
    const error = new Error('service unavailable');
    error.name = 'InternalErrorException';
    confirmForgotPasswordAndRevokeSessionsMock.mockRejectedValueOnce(error);

    const response = await POST(
      createRequest({
        email: 'user@example.com',
        code: '123456',
        newPassword: 'New-Password-12345!',
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
      message: 'パスワードの再設定に失敗しました',
    });
  });

  it('does not reveal whether the reset identity exists', async () => {
    const error = new Error('unknown user');
    error.name = 'UserNotFoundException';
    confirmForgotPasswordAndRevokeSessionsMock.mockRejectedValueOnce(error);

    const response = await POST(
      createRequest({
        email: 'unknown@example.com',
        code: '123456',
        newPassword: 'New-Password-12345!',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
      message: '確認コードが正しくありません',
    });
  });
});
