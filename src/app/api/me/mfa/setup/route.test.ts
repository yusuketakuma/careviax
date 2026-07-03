import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, getAuthAccessTokenMock, associateTotpForAccessTokenMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getAuthAccessTokenMock: vi.fn(),
  associateTotpForAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
  getAuthAccessToken: getAuthAccessTokenMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  associateTotpForAccessToken: associateTotpForAccessTokenMock,
}));

import { POST } from './route';

describe('/api/me/mfa/setup POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      user: {
        email: 'user@example.com',
      },
    });
    getAuthAccessTokenMock.mockResolvedValue('token');
    associateTotpForAccessTokenMock.mockResolvedValue({
      SecretCode: 'ABC123',
    });
  });

  it('returns MFA secret setup data', async () => {
    const response = await POST(new NextRequest('http://localhost/api/me/mfa/setup'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      secretCode: 'ABC123',
      otpauthUri: expect.stringContaining('otpauth://totp/PH-OS:user%40example.com'),
    });
  });
});
