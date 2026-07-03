import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const { authenticateWithPasswordMock, respondToSoftwareTokenChallengeMock } = vi.hoisted(() => ({
  authenticateWithPasswordMock: vi.fn(),
  respondToSoftwareTokenChallengeMock: vi.fn(),
}));

vi.mock('@/server/services/cognito-auth', () => ({
  authenticateWithPassword: authenticateWithPasswordMock,
  respondToSoftwareTokenChallenge: respondToSoftwareTokenChallengeMock,
}));

import { verifyBreakGlassStepUp } from './step-up-mfa';
import { encodeCognitoChallenge } from '@/lib/auth/cognito-challenge';

const args = { email: 'op@example.com', password: 'pw', code: '123456' };

function mfaChallengeError() {
  return new Error(
    encodeCognitoChallenge({
      type: 'SOFTWARE_TOKEN_MFA',
      email: args.email,
      session: 'cognito-session-token',
    }),
  );
}

describe('verifyBreakGlassStepUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) returns false when password auth resolves without an MFA challenge', async () => {
    authenticateWithPasswordMock.mockResolvedValue({ ok: true });
    await expect(verifyBreakGlassStepUp(args)).resolves.toBe(false);
    expect(respondToSoftwareTokenChallengeMock).not.toHaveBeenCalled();
  });

  it('(b) returns false when password auth throws a non-challenge error (wrong password)', async () => {
    authenticateWithPasswordMock.mockRejectedValue(new Error('AUTH_FAILED'));
    await expect(verifyBreakGlassStepUp(args)).resolves.toBe(false);
    expect(respondToSoftwareTokenChallengeMock).not.toHaveBeenCalled();
  });

  it('(c) returns false when the TOTP response throws (wrong/expired code)', async () => {
    authenticateWithPasswordMock.mockRejectedValue(mfaChallengeError());
    respondToSoftwareTokenChallengeMock.mockRejectedValue(new Error('CodeMismatchException'));
    await expect(verifyBreakGlassStepUp(args)).resolves.toBe(false);
    expect(respondToSoftwareTokenChallengeMock).toHaveBeenCalledWith({
      email: args.email,
      code: args.code,
      session: 'cognito-session-token',
    });
  });

  it('(d) returns true when both password and TOTP succeed', async () => {
    authenticateWithPasswordMock.mockRejectedValue(mfaChallengeError());
    respondToSoftwareTokenChallengeMock.mockResolvedValue({ ok: true });
    await expect(verifyBreakGlassStepUp(args)).resolves.toBe(true);
  });

  it('returns false when the thrown error is a challenge of a non-MFA type', async () => {
    authenticateWithPasswordMock.mockRejectedValue(
      new Error(
        encodeCognitoChallenge({
          type: 'NEW_PASSWORD_REQUIRED',
          email: args.email,
          session: 'sess',
        }),
      ),
    );
    await expect(verifyBreakGlassStepUp(args)).resolves.toBe(false);
    expect(respondToSoftwareTokenChallengeMock).not.toHaveBeenCalled();
  });

  it('returns false when the thrown error carries no decodable challenge message', async () => {
    // non-Error throw → challengeMessage stays null → decode → null
    authenticateWithPasswordMock.mockRejectedValue('boom');
    await expect(verifyBreakGlassStepUp(args)).resolves.toBe(false);
  });
});
