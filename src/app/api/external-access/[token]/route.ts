import { NextRequest } from 'next/server';
import { success, notFound, validationError, error } from '@/lib/api/response';
import {
  buildExternalAccessPayload,
  markExternalAccessViewed,
  validateExternalAccessGrant,
} from '@/server/services/external-access';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';
import {
  createExternalAccessOtpRateLimitIdentifier,
  EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH,
} from '../shared';

/**
 * Public endpoint — no authentication required.
 * Validates token + OTP, returns scoped patient data.
 * OTP is read from the `x-otp` request header (not a URL query param).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = normalizeRequiredRouteParam(rawToken);
  if (!token) return validationError('共有リンクトークンが不正です');

  const ip = getClientIp(req) ?? 'unknown';
  const rateLimit = await checkAuthRateLimit(
    createExternalAccessOtpRateLimitIdentifier(token, ip),
    EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH,
  );
  if (!rateLimit.allowed) {
    return error(
      'RATE_LIMIT_EXCEEDED',
      'リクエストが多すぎます。しばらく待ってから再試行してください。',
      429,
    );
  }

  // OTP is transmitted via header to avoid leaking it in server logs / browser history.
  const otpParam = req.headers.get('x-otp');
  const validation = await validateExternalAccessGrant(token, otpParam);

  if (!validation.ok) {
    if (validation.kind === 'validation') {
      return validationError(validation.message);
    }

    return notFound(validation.message);
  }

  const payload = await buildExternalAccessPayload(validation.grant);

  if (!payload) return notFound('患者情報が見つかりません');

  await markExternalAccessViewed(validation.grant.id);
  return success({ data: payload });
}
