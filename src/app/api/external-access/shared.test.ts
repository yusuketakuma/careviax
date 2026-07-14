import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  checkAuthRateLimitMock,
  checkExternalAccessOtpLockoutMock,
  recordExternalAccessOtpFailureMock,
  validateExternalAccessGrantMock,
} = vi.hoisted(() => ({
  checkAuthRateLimitMock: vi.fn(),
  checkExternalAccessOtpLockoutMock: vi.fn(),
  recordExternalAccessOtpFailureMock: vi.fn(),
  validateExternalAccessGrantMock: vi.fn(),
}));

vi.mock('@/lib/api/rate-limit', () => ({
  checkAuthRateLimit: checkAuthRateLimitMock,
  checkExternalAccessOtpLockout: checkExternalAccessOtpLockoutMock,
  recordExternalAccessOtpFailure: recordExternalAccessOtpFailureMock,
}));

vi.mock('@/server/services/external-access', () => ({
  validateExternalAccessGrant: validateExternalAccessGrantMock,
}));

import {
  createExternalAccessOtpLockoutIdentifier,
  validatePreparedExternalAccessGrant,
} from './shared';

const TOKEN = 'signed-external-access-token';
const OTHER_TOKEN = 'other-signed-external-access-token';
const VALID_GRANT = {
  id: 'grant_1',
  org_id: 'org_1',
  patient_id: 'patient_1',
  granted_to_name: 'External recipient',
  granted_to_contact: null,
  scope: { medication_list: true },
};

function prepared(token = TOKEN, otp: string | null = '123456') {
  return { token, otp };
}

describe('external access OTP durable lockout orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkExternalAccessOtpLockoutMock.mockResolvedValue({
      available: true,
      locked: false,
      attempts: 0,
    });
    recordExternalAccessOtpFailureMock.mockResolvedValue({
      available: true,
      locked: false,
      attempts: 1,
    });
    validateExternalAccessGrantMock.mockResolvedValue({ ok: true, grant: VALID_GRANT });
  });

  it('derives a stable domain-separated digest without exposing the raw token or DB token hash', () => {
    const identifier = createExternalAccessOtpLockoutIdentifier(TOKEN);

    expect(identifier).toMatch(/^[a-f0-9]{64}$/);
    expect(identifier).toBe(createExternalAccessOtpLockoutIdentifier(TOKEN));
    expect(identifier).not.toBe(createExternalAccessOtpLockoutIdentifier(OTHER_TOKEN));
    expect(identifier).not.toBe(createHash('sha256').update(TOKEN).digest('hex'));
    expect(identifier).not.toContain(TOKEN);
  });

  it('aggregates GET and self-report mismatch call shapes under the same token digest', async () => {
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'OTPが正しくありません',
      failure: 'otp_mismatch',
    });

    const getResult = await validatePreparedExternalAccessGrant(prepared());
    const selfReportResult = await validatePreparedExternalAccessGrant(prepared(), {
      missingOtpValue: undefined,
    });

    expect(getResult.ok).toBe(false);
    expect(selfReportResult.ok).toBe(false);
    expect(recordExternalAccessOtpFailureMock).toHaveBeenCalledTimes(2);
    expect(recordExternalAccessOtpFailureMock).toHaveBeenNthCalledWith(
      1,
      createExternalAccessOtpLockoutIdentifier(TOKEN),
    );
    expect(recordExternalAccessOtpFailureMock).toHaveBeenNthCalledWith(
      2,
      createExternalAccessOtpLockoutIdentifier(TOKEN),
    );
    expect(checkExternalAccessOtpLockoutMock).not.toHaveBeenCalled();
  });

  it('returns the same generic 404 for the locking mismatch and later wrong or correct OTPs', async () => {
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'OTPが正しくありません',
      failure: 'otp_mismatch',
    });
    recordExternalAccessOtpFailureMock.mockResolvedValue({
      available: true,
      locked: true,
      attempts: 10,
    });

    const lockingMismatch = await validatePreparedExternalAccessGrant(prepared());
    const lockedMismatch = await validatePreparedExternalAccessGrant(prepared(TOKEN, '654321'));
    expect(lockingMismatch.ok).toBe(false);
    expect(lockedMismatch.ok).toBe(false);
    if (lockingMismatch.ok || lockedMismatch.ok) throw new Error('Expected locked responses');
    expectSensitiveNoStore(lockingMismatch.response);
    expectSensitiveNoStore(lockedMismatch.response);
    const lockingBody = await lockingMismatch.response.json();
    const lockedMismatchBody = await lockedMismatch.response.json();

    validateExternalAccessGrantMock.mockResolvedValue({ ok: true, grant: VALID_GRANT });
    checkExternalAccessOtpLockoutMock.mockResolvedValue({
      available: true,
      locked: true,
      attempts: 10,
    });
    const lockedCorrect = await validatePreparedExternalAccessGrant(prepared());
    expect(lockedCorrect.ok).toBe(false);
    if (lockedCorrect.ok) throw new Error('Expected a locked response');
    expectSensitiveNoStore(lockedCorrect.response);
    const lockedCorrectBody = await lockedCorrect.response.json();

    expect(lockingMismatch.response.status).toBe(404);
    expect(lockedMismatch.response.status).toBe(404);
    expect(lockedCorrect.response.status).toBe(404);
    expect(lockingBody).toEqual({
      code: 'WORKFLOW_NOT_FOUND',
      message: '共有リンクが無効または期限切れです',
    });
    expect(lockedMismatchBody).toEqual(lockingBody);
    expect(lockedCorrectBody).toEqual(lockingBody);
  });

  it('returns the same fixed PHI-free 500 when the counter store fails for wrong or correct OTPs', async () => {
    validateExternalAccessGrantMock.mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'OTPが正しくありません',
      failure: 'otp_mismatch',
    });
    recordExternalAccessOtpFailureMock.mockResolvedValue({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_unavailable',
    });
    const wrongOtp = await validatePreparedExternalAccessGrant(prepared(TOKEN, 'LEAK_OTP'));
    expect(wrongOtp.ok).toBe(false);
    if (wrongOtp.ok) throw new Error('Expected a store failure response');
    const wrongBody = await wrongOtp.response.json();

    validateExternalAccessGrantMock.mockResolvedValue({ ok: true, grant: VALID_GRANT });
    checkExternalAccessOtpLockoutMock.mockResolvedValue({
      available: false,
      locked: true,
      attempts: null,
      reason: 'store_unavailable',
    });
    const correctOtp = await validatePreparedExternalAccessGrant(prepared());
    expect(correctOtp.ok).toBe(false);
    if (correctOtp.ok) throw new Error('Expected a store failure response');
    const correctBody = await correctOtp.response.json();

    expect(wrongOtp.response.status).toBe(500);
    expect(correctOtp.response.status).toBe(500);
    expectSensitiveNoStore(wrongOtp.response);
    expectSensitiveNoStore(correctOtp.response);
    expect(wrongBody).toEqual({
      code: 'INTERNAL_ERROR',
      message: '外部共有を確認できませんでした',
    });
    expect(correctBody).toEqual(wrongBody);
    expect(JSON.stringify([wrongBody, correctBody])).not.toContain(TOKEN);
    expect(JSON.stringify([wrongBody, correctBody])).not.toContain('LEAK_OTP');
  });

  it.each([
    {
      label: 'missing OTP',
      result: { ok: false, kind: 'validation', message: 'OTPが必要です' },
      otp: null,
    },
    {
      label: 'invalid scope',
      result: { ok: false, kind: 'validation', message: '共有範囲が不正です' },
      otp: '123456',
    },
    {
      label: 'invalid, expired, or revoked grant',
      result: { ok: false, kind: 'not_found', message: '共有リンクが無効または期限切れです' },
      otp: '123456',
    },
  ])('does not allocate durable state for $label', async ({ result, otp }) => {
    validateExternalAccessGrantMock.mockResolvedValue(result);

    const validation = await validatePreparedExternalAccessGrant(prepared(TOKEN, otp));

    expect(validation.ok).toBe(false);
    expect(recordExternalAccessOtpFailureMock).not.toHaveBeenCalled();
    expect(checkExternalAccessOtpLockoutMock).not.toHaveBeenCalled();
  });
});
