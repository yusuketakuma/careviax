import { createHash } from 'node:crypto';

export const EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH = '/api/external-access/otp';

export function createExternalAccessOtpRateLimitIdentifier(token: string, ipAddress: string) {
  return createHash('sha256')
    .update(`${token}:${ipAddress}`)
    .digest('hex');
}
