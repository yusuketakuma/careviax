import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmForgotPasswordMock } = vi.hoisted(() => ({
  confirmForgotPasswordMock: vi.fn(),
}));

vi.mock('@/server/services/cognito-auth', () => ({
  confirmForgotPassword: confirmForgotPasswordMock,
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
    confirmForgotPasswordMock.mockResolvedValue(undefined);
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
    expect(confirmForgotPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      code: '123456',
      newPassword: 'New-Password-12345!',
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
    expect(confirmForgotPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      code: '123456',
      newPassword: 'New-Password-12345!',
    });
  });

  it('rejects non-object JSON payloads before confirming the password reset', async () => {
    const response = await POST(createRequest([]));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(confirmForgotPasswordMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON payloads before confirming the password reset', async () => {
    const response = await POST(createMalformedRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(confirmForgotPasswordMock).not.toHaveBeenCalled();
  });

  it('returns a client error when the confirmation code is incorrect', async () => {
    const error = new Error('mismatch');
    error.name = 'CodeMismatchException';
    confirmForgotPasswordMock.mockRejectedValueOnce(error);

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
    confirmForgotPasswordMock.mockRejectedValueOnce(error);

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
});
