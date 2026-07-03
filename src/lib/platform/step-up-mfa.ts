import 'server-only';
import {
  authenticateWithPassword,
  respondToSoftwareTokenChallenge,
} from '@/server/services/cognito-auth';
import { decodeCognitoChallenge } from '@/lib/auth/cognito-challenge';

/**
 * Full step-up re-authentication for a high-privilege break-glass action.
 * Re-verifies BOTH the operator's password and current TOTP against Cognito:
 * `authenticateWithPassword` throws an encoded SOFTWARE_TOKEN_MFA challenge for
 * an MFA-enrolled account, which we answer with `respondToSoftwareTokenChallenge`.
 *
 * Returns true ONLY when password + TOTP both succeed. Fail-closed on every other
 * outcome: a wrong password (AUTH_FAILED, no decodable challenge), a non-MFA
 * challenge, an account without MFA (no challenge thrown at all — operators must
 * have MFA enrolled), or a wrong/expired code.
 */
export async function verifyBreakGlassStepUp(args: {
  email: string;
  password: string;
  code: string;
}): Promise<boolean> {
  let challengeMessage: string | null = null;
  try {
    await authenticateWithPassword({ email: args.email, password: args.password });
    // No challenge thrown → the account is not MFA-gated → not acceptable.
    return false;
  } catch (err) {
    challengeMessage = err instanceof Error ? err.message : null;
  }

  const challenge = challengeMessage ? decodeCognitoChallenge(challengeMessage) : null;
  if (!challenge || challenge.type !== 'SOFTWARE_TOKEN_MFA') {
    return false;
  }

  try {
    await respondToSoftwareTokenChallenge({
      email: args.email,
      code: args.code,
      session: challenge.session,
    });
    return true;
  } catch {
    return false;
  }
}
