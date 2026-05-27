import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  getAuthAccessTokenMock,
  userFindUniqueMock,
  resolveLocalUserByIdentityMock,
  verifyTotpForAccessTokenMock,
  issueMfaRecoveryCodesMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getAuthAccessTokenMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  resolveLocalUserByIdentityMock: vi.fn(),
  verifyTotpForAccessTokenMock: vi.fn(),
  issueMfaRecoveryCodesMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
  getAuthAccessToken: getAuthAccessTokenMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock('@/lib/auth/user-resolution', () => ({
  resolveLocalUserByIdentity: resolveLocalUserByIdentityMock,
}));

vi.mock('@/server/services/cognito-auth', () => ({
  verifyTotpForAccessToken: verifyTotpForAccessTokenMock,
}));

vi.mock('@/server/services/mfa-recovery', () => ({
  issueMfaRecoveryCodes: issueMfaRecoveryCodesMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/me/mfa/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/me/mfa/verify POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthAccessTokenMock.mockResolvedValue('access-token');
    verifyTotpForAccessTokenMock.mockResolvedValue(undefined);
    issueMfaRecoveryCodesMock.mockResolvedValue(['ABCD-EFGH', 'JKLM-NPQR']);
    userFindUniqueMock.mockResolvedValue({ id: 'user_1' });
    resolveLocalUserByIdentityMock.mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await POST(createRequest({ code: '123456' }));

    expect(response.status).toBe(401);
  });

  it('returns 400 when code is missing', async () => {
    authMock.mockResolvedValue({
      user: { id: 'user_1', email: 'pharmacist@example.com' },
    });

    const response = await POST(createRequest({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('verifies totp and returns recovery codes for the current user', async () => {
    authMock.mockResolvedValue({
      user: { id: 'user_1', email: 'pharmacist@example.com' },
    });

    const response = await POST(createRequest({ code: '123456' }));

    expect(response.status).toBe(200);
    expect(verifyTotpForAccessTokenMock).toHaveBeenCalledWith({
      accessToken: 'access-token',
      code: '123456',
      deviceName: 'PH-OS TOTP',
    });
    expect(issueMfaRecoveryCodesMock).toHaveBeenCalledWith('user_1');
    await expect(response.json()).resolves.toEqual({
      ok: true,
      recoveryCodes: ['ABCD-EFGH', 'JKLM-NPQR'],
    });
  });

  it('falls back to identity resolution when session user id is not a local user', async () => {
    authMock.mockResolvedValue({
      user: {
        id: 'external-user',
        email: 'pharmacist@example.com',
        cognitoSub: 'sub_123',
      },
    });
    userFindUniqueMock.mockResolvedValue(null);
    resolveLocalUserByIdentityMock.mockResolvedValue({ id: 'user_2' });

    const response = await POST(createRequest({ code: '123456' }));

    expect(response.status).toBe(200);
    expect(resolveLocalUserByIdentityMock).toHaveBeenCalledWith({
      cognitoSub: 'sub_123',
      email: 'pharmacist@example.com',
    });
    expect(issueMfaRecoveryCodesMock).toHaveBeenCalledWith('user_2');
  });

  it('returns 400 when the totp code is invalid', async () => {
    authMock.mockResolvedValue({
      user: { id: 'user_1', email: 'pharmacist@example.com' },
    });
    verifyTotpForAccessTokenMock.mockRejectedValue(new Error('bad code'));

    const response = await POST(createRequest({ code: '999999' }));

    expect(response.status).toBe(400);
    expect(issueMfaRecoveryCodesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_MFA_VERIFY_FAILED',
    });
  });
});
