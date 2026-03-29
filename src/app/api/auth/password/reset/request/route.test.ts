import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startForgotPasswordMock } = vi.hoisted(() => ({
  startForgotPasswordMock: vi.fn(),
}));

vi.mock('@/server/services/cognito-auth', () => ({
  startForgotPassword: startForgotPasswordMock,
}));

import { POST } from './route';

describe('/api/auth/password/reset/request POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startForgotPasswordMock.mockResolvedValue(undefined);
  });

  it('starts forgot-password flow for a valid email', async () => {
    const response = await POST({
      json: async () => ({
        email: 'user@example.com',
      }),
    } as Request);

    expect(response.status).toBe(200);
    expect(startForgotPasswordMock).toHaveBeenCalledWith('user@example.com');
  });
});
