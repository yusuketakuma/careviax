import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkAuthRateLimitMock, getClientIpMock, startForgotPasswordMock } = vi.hoisted(() => ({
  checkAuthRateLimitMock: vi.fn(),
  getClientIpMock: vi.fn(),
  startForgotPasswordMock: vi.fn(),
}));

vi.mock('@/lib/api/rate-limit', () => ({
  checkAuthRateLimit: checkAuthRateLimitMock,
}));

vi.mock('@/lib/api/request-ip', () => ({
  getClientIp: getClientIpMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  startForgotPassword: startForgotPasswordMock,
}));

import { POST } from './route';

function createPasswordResetRequest(email: string) {
  return new Request('http://localhost/api/auth/password/reset/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

describe('/api/auth/password/reset/request POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkAuthRateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
    getClientIpMock.mockReturnValue('203.0.113.10');
    startForgotPasswordMock.mockResolvedValue(undefined);
  });

  it('starts forgot-password flow for a valid email', async () => {
    const response = await POST(createPasswordResetRequest('user@example.com'));

    expect(response.status).toBe(200);
    expect(startForgotPasswordMock).toHaveBeenCalledWith('user@example.com');
  });

  it('returns a generic success response when the email does not exist', async () => {
    const error = new Error('missing user');
    error.name = 'UserNotFoundException';
    startForgotPasswordMock.mockRejectedValue(error);

    const response = await POST(createPasswordResetRequest('missing@example.com'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it('rate limits repeated password reset requests', async () => {
    checkAuthRateLimitMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    const response = await POST(createPasswordResetRequest('user@example.com'));

    expect(response.status).toBe(429);
    expect(startForgotPasswordMock).not.toHaveBeenCalled();
  });
});
