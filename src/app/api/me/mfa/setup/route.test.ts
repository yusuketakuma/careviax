import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, associateTotpForAccessTokenMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  associateTotpForAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  associateTotpForAccessToken: associateTotpForAccessTokenMock,
}));

import { POST } from './route';

describe('/api/me/mfa/setup POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      accessToken: 'token',
      user: {
        email: 'user@example.com',
      },
    });
    associateTotpForAccessTokenMock.mockResolvedValue({
      SecretCode: 'ABC123',
    });
  });

  it('returns MFA secret setup data', async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      secretCode: 'ABC123',
      otpauthUri: expect.stringContaining('otpauth://totp/CareViaX:user%40example.com'),
    });
  });
});
