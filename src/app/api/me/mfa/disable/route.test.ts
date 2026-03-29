import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, disableTotpForAccessTokenMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  disableTotpForAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  disableTotpForAccessToken: disableTotpForAccessTokenMock,
}));

import { DELETE } from './route';

describe('/api/me/mfa/disable DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({
      accessToken: 'token',
    });
    disableTotpForAccessTokenMock.mockResolvedValue(undefined);
  });

  it('disables MFA for the active session', async () => {
    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(disableTotpForAccessTokenMock).toHaveBeenCalledWith('token');
  });
});
