import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmForgotPasswordMock } = vi.hoisted(() => ({
  confirmForgotPasswordMock: vi.fn(),
}));

vi.mock('@/server/services/cognito-auth', () => ({
  confirmForgotPassword: confirmForgotPasswordMock,
}));

import { POST } from './route';

describe('/api/auth/password/reset/confirm POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmForgotPasswordMock.mockResolvedValue(undefined);
  });

  it('confirms password reset for a valid payload', async () => {
    const response = await POST({
      json: async () => ({
        email: 'user@example.com',
        code: '123456',
        newPassword: 'New-Password-12345!',
      }),
    } as Request);

    expect(response.status).toBe(200);
    expect(confirmForgotPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      code: '123456',
      newPassword: 'New-Password-12345!',
    });
  });

  it('trims surrounding whitespace before confirming the password reset', async () => {
    const response = await POST({
      json: async () => ({
        email: ' user@example.com ',
        code: ' 123456 ',
        newPassword: ' New-Password-12345! ',
      }),
    } as Request);

    expect(response.status).toBe(200);
    expect(confirmForgotPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      code: '123456',
      newPassword: 'New-Password-12345!',
    });
  });

  it('returns a client error when the confirmation code is incorrect', async () => {
    const error = new Error('mismatch');
    error.name = 'CodeMismatchException';
    confirmForgotPasswordMock.mockRejectedValueOnce(error);

    const response = await POST({
      json: async () => ({
        email: 'user@example.com',
        code: '123456',
        newPassword: 'New-Password-12345!',
      }),
    } as Request);

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

    const response = await POST({
      json: async () => ({
        email: 'user@example.com',
        code: '123456',
        newPassword: 'New-Password-12345!',
      }),
    } as Request);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
      message: 'パスワードの再設定に失敗しました',
    });
  });
});
