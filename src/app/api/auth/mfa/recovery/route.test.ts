import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  userFindUniqueMock,
  takeMfaRecoveryCodesForRecoveryMock,
  clearMfaRecoveryCodesMock,
  restoreMfaRecoveryCodesMock,
  disableCognitoTotpForUserMock,
  MfaRecoveryConfigErrorMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  takeMfaRecoveryCodesForRecoveryMock: vi.fn(),
  clearMfaRecoveryCodesMock: vi.fn(),
  restoreMfaRecoveryCodesMock: vi.fn(),
  disableCognitoTotpForUserMock: vi.fn(),
  MfaRecoveryConfigErrorMock: class MfaRecoveryConfigError extends Error {
    constructor(message = 'MFA recovery secret is not configured') {
      super(message);
      this.name = 'MfaRecoveryConfigError';
    }
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock('@/server/services/mfa-recovery', () => ({
  MfaRecoveryConfigError: MfaRecoveryConfigErrorMock,
  takeMfaRecoveryCodesForRecovery: takeMfaRecoveryCodesForRecoveryMock,
  clearMfaRecoveryCodes: clearMfaRecoveryCodesMock,
  restoreMfaRecoveryCodes: restoreMfaRecoveryCodesMock,
}));

vi.mock('@/server/services/cognito-admin', () => ({
  disableCognitoTotpForUser: disableCognitoTotpForUserMock,
}));

vi.mock('@/lib/api/rate-limit', () => ({
  checkAuthRateLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 }),
}));

import { POST } from './route';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';

function createRequest(body: unknown) {
  return new Request('http://localhost/api/auth/mfa/recovery', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedRequest() {
  return new Request('http://localhost/api/auth/mfa/recovery', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
}

describe('/api/auth/mfa/recovery POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAuthRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60000,
    });
    userFindUniqueMock.mockResolvedValue({
      id: 'user_1',
      email: 'pharmacist@example.com',
      cognito_username: 'pharmacist@example.com',
    });
    takeMfaRecoveryCodesForRecoveryMock.mockResolvedValue({
      version: 1,
      hashes: ['hash_1'],
      generatedAt: '2026-04-04T00:00:00.000Z',
    });
    disableCognitoTotpForUserMock.mockResolvedValue(undefined);
    clearMfaRecoveryCodesMock.mockResolvedValue(undefined);
    restoreMfaRecoveryCodesMock.mockResolvedValue(undefined);
  });

  it('returns 400 when request body is invalid', async () => {
    const response = await POST(createRequest({ email: 'invalid', recoveryCode: '' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects non-object request bodies before user lookup or recovery side effects', async () => {
    const response = await POST(createRequest(['unexpected']));

    expect(response.status).toBe(400);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(takeMfaRecoveryCodesForRecoveryMock).not.toHaveBeenCalled();
    expect(disableCognitoTotpForUserMock).not.toHaveBeenCalled();
    expect(clearMfaRecoveryCodesMock).not.toHaveBeenCalled();
    expect(restoreMfaRecoveryCodesMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before user lookup or recovery side effects', async () => {
    const response = await POST(createMalformedRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(takeMfaRecoveryCodesForRecoveryMock).not.toHaveBeenCalled();
    expect(disableCognitoTotpForUserMock).not.toHaveBeenCalled();
    expect(clearMfaRecoveryCodesMock).not.toHaveBeenCalled();
    expect(restoreMfaRecoveryCodesMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the recovery code does not match', async () => {
    takeMfaRecoveryCodesForRecoveryMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        email: 'pharmacist@example.com',
        recoveryCode: 'ABCD-EFGH',
      }),
    );

    expect(response.status).toBe(400);
    expect(disableCognitoTotpForUserMock).not.toHaveBeenCalled();
    expect(clearMfaRecoveryCodesMock).not.toHaveBeenCalled();
    expect(restoreMfaRecoveryCodesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_RECOVERY_CODE_INVALID',
    });
  });

  it('disables totp after atomically reserving the recovery codes when a valid code is supplied', async () => {
    const response = await POST(
      createRequest({
        email: 'pharmacist@example.com',
        recoveryCode: 'ABCD-EFGH',
      }),
    );

    expect(response.status).toBe(200);
    expect(takeMfaRecoveryCodesForRecoveryMock).toHaveBeenCalledWith('user_1', 'ABCD-EFGH');
    expect(disableCognitoTotpForUserMock).toHaveBeenCalledWith('pharmacist@example.com');
    expect(clearMfaRecoveryCodesMock).toHaveBeenCalledWith('user_1');
    expect(restoreMfaRecoveryCodesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
    });
  });

  it('trims whitespace around email and recovery code before validating and recovering', async () => {
    const response = await POST(
      createRequest({
        email: ' Pharmacist@Example.com ',
        recoveryCode: ' ABCD-EFGH ',
      }),
    );

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { email: 'pharmacist@example.com' },
      select: {
        id: true,
        email: true,
        cognito_username: true,
      },
    });
    expect(takeMfaRecoveryCodesForRecoveryMock).toHaveBeenCalledWith('user_1', 'ABCD-EFGH');
  });

  it('returns 502 when cognito update fails', async () => {
    disableCognitoTotpForUserMock.mockRejectedValue(new Error('cognito down'));

    const response = await POST(
      createRequest({
        email: 'pharmacist@example.com',
        recoveryCode: 'ABCD-EFGH',
      }),
    );

    expect(response.status).toBe(502);
    expect(clearMfaRecoveryCodesMock).not.toHaveBeenCalled();
    expect(restoreMfaRecoveryCodesMock).toHaveBeenCalledWith(
      'user_1',
      expect.objectContaining({
        version: 1,
        hashes: ['hash_1'],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_MFA_RECOVERY_FAILED',
    });
  });

  it('returns 503 when MFA recovery is not configured on the server', async () => {
    const error = new MfaRecoveryConfigErrorMock('missing secret');
    takeMfaRecoveryCodesForRecoveryMock.mockRejectedValueOnce(error);

    const response = await POST(
      createRequest({
        email: 'pharmacist@example.com',
        recoveryCode: 'ABCD-EFGH',
      }),
    );

    expect(response.status).toBe(503);
    expect(disableCognitoTotpForUserMock).not.toHaveBeenCalled();
    expect(clearMfaRecoveryCodesMock).not.toHaveBeenCalled();
    expect(restoreMfaRecoveryCodesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXTERNAL_MFA_RECOVERY_FAILED',
      message: 'MFAリカバリー設定が未完了です',
    });
  });
});
