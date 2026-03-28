import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  userFindUniqueMock,
  verifyMfaRecoveryCodeMock,
  clearMfaRecoveryCodesMock,
  disableCognitoTotpForUserMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  verifyMfaRecoveryCodeMock: vi.fn(),
  clearMfaRecoveryCodesMock: vi.fn(),
  disableCognitoTotpForUserMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock('@/server/services/mfa-recovery', () => ({
  verifyMfaRecoveryCode: verifyMfaRecoveryCodeMock,
  clearMfaRecoveryCodes: clearMfaRecoveryCodesMock,
}));

vi.mock('@/server/services/cognito-admin', () => ({
  disableCognitoTotpForUser: disableCognitoTotpForUserMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new Request('http://localhost/api/auth/mfa/recovery', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('/api/auth/mfa/recovery POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      id: 'user_1',
      email: 'pharmacist@example.com',
      cognito_username: 'pharmacist@example.com',
    });
    verifyMfaRecoveryCodeMock.mockResolvedValue(true);
    disableCognitoTotpForUserMock.mockResolvedValue(undefined);
    clearMfaRecoveryCodesMock.mockResolvedValue(undefined);
  });

  it('returns 400 when request body is invalid', async () => {
    const response = await POST(createRequest({ email: 'invalid', recoveryCode: '' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('returns 400 when the recovery code does not match', async () => {
    verifyMfaRecoveryCodeMock.mockResolvedValue(false);

    const response = await POST(
      createRequest({
        email: 'pharmacist@example.com',
        recoveryCode: 'ABCD-EFGH',
      })
    );

    expect(response.status).toBe(400);
    expect(disableCognitoTotpForUserMock).not.toHaveBeenCalled();
    expect(clearMfaRecoveryCodesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_RECOVERY_CODE_INVALID',
    });
  });

  it('disables totp and clears recovery codes when a valid code is supplied', async () => {
    const response = await POST(
      createRequest({
        email: 'pharmacist@example.com',
        recoveryCode: 'ABCD-EFGH',
      })
    );

    expect(response.status).toBe(200);
    expect(verifyMfaRecoveryCodeMock).toHaveBeenCalledWith('user_1', 'ABCD-EFGH');
    expect(disableCognitoTotpForUserMock).toHaveBeenCalledWith('pharmacist@example.com');
    expect(clearMfaRecoveryCodesMock).toHaveBeenCalledWith('user_1');
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
    });
  });

  it('returns 502 when cognito update fails', async () => {
    disableCognitoTotpForUserMock.mockRejectedValue(new Error('cognito down'));

    const response = await POST(
      createRequest({
        email: 'pharmacist@example.com',
        recoveryCode: 'ABCD-EFGH',
      })
    );

    expect(response.status).toBe(502);
    expect(clearMfaRecoveryCodesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_MFA_RECOVERY_FAILED',
    });
  });
});
