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
        newPassword: 'new-password-12345',
      }),
    } as Request);

    expect(response.status).toBe(200);
    expect(confirmForgotPasswordMock).toHaveBeenCalledWith({
      email: 'user@example.com',
      code: '123456',
      newPassword: 'new-password-12345',
    });
  });
});
