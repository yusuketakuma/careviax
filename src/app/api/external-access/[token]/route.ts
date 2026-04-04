import { NextRequest } from 'next/server';
import { success, notFound, validationError, error } from '@/lib/api/response';
import {
  buildExternalAccessPayload,
  markExternalAccessViewed,
  validateExternalAccessGrant,
} from '@/server/services/external-access';
import { createRateLimiter } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';

const otpRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });

/**
 * Public endpoint — no authentication required.
 * Validates token + OTP, returns scoped patient data.
 * OTP is read from the `x-otp` request header (not a URL query param).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(req) ?? 'unknown';
  const rl = await otpRateLimiter(`otp-verify:${ip}`);
  if (!rl.allowed) {
    return error(
      'RATE_LIMIT_EXCEEDED',
      'リクエストが多すぎます。しばらく待ってから再試行してください。',
      429
    );
  }

  const { token } = await params;
  // OTP is transmitted via header to avoid leaking it in server logs / browser history.
  const otpParam = req.headers.get('x-otp');
  const validation = await validateExternalAccessGrant(token, otpParam);

  if (!validation.ok) {
    if (validation.kind === 'validation') {
      return validationError(validation.message);
    }

    return notFound(validation.message);
  }

  await markExternalAccessViewed(validation.grant.id);
  const payload = await buildExternalAccessPayload(validation.grant);

  if (!payload) return notFound('患者情報が見つかりません');

  return success({ data: payload });
}
