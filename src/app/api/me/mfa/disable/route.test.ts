import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, getAuthAccessTokenMock, disableTotpForAccessTokenMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getAuthAccessTokenMock: vi.fn(),
  disableTotpForAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
  getAuthAccessToken: getAuthAccessTokenMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  disableTotpForAccessToken: disableTotpForAccessTokenMock,
}));

import { DELETE } from './route';

describe('/api/me/mfa/disable DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getAuthAccessTokenMock.mockResolvedValue('token');
    disableTotpForAccessTokenMock.mockResolvedValue(undefined);
  });

  it('disables MFA for the active session', async () => {
    const response = await DELETE(new NextRequest('http://localhost/api/me/mfa/disable'));

    expect(response.status).toBe(200);
    expect(disableTotpForAccessTokenMock).toHaveBeenCalledWith('token');
  });
});
