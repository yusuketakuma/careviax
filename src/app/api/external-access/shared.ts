import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { error, notFound, validationError } from '@/lib/api/response';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateExternalAccessGrant } from '@/server/services/external-access';

export const EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH = '/api/external-access/otp';

export function createExternalAccessOtpRateLimitIdentifier(token: string, ipAddress: string) {
  return createHash('sha256').update(`${token}:${ipAddress}`).digest('hex');
}

type PreparedExternalAccessOtpRequest = {
  token: string;
  otp: string | null;
};

type PublicExternalAccessGrant = Extract<
  Awaited<ReturnType<typeof validateExternalAccessGrant>>,
  { ok: true }
>['grant'];

export async function prepareExternalAccessOtpRequest(
  req: NextRequest,
  rawToken: string,
): Promise<
  { ok: true; request: PreparedExternalAccessOtpRequest } | { ok: false; response: Response }
> {
  const token = normalizeRequiredRouteParam(rawToken);
  if (!token) {
    return {
      ok: false,
      response: withSensitiveNoStore(validationError('共有リンクトークンが不正です')),
    };
  }

  const ip = getClientIp(req) ?? 'unknown';
  const rateLimit = await checkAuthRateLimit(
    createExternalAccessOtpRateLimitIdentifier(token, ip),
    EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH,
  );
  if (!rateLimit.allowed) {
    return {
      ok: false,
      response: withSensitiveNoStore(
        error(
          'RATE_LIMIT_EXCEEDED',
          'リクエストが多すぎます。しばらく待ってから再試行してください。',
          429,
        ),
      ),
    };
  }

  return {
    ok: true,
    request: {
      token,
      otp: req.headers.get('x-otp'),
    },
  };
}

export async function validatePreparedExternalAccessGrant(
  prepared: PreparedExternalAccessOtpRequest,
  options: { missingOtpValue?: null | undefined } = {},
): Promise<{ ok: true; grant: PublicExternalAccessGrant } | { ok: false; response: Response }> {
  const otp =
    prepared.otp === null
      ? 'missingOtpValue' in options
        ? options.missingOtpValue
        : null
      : prepared.otp;
  const validation = await validateExternalAccessGrant(prepared.token, otp);

  if (!validation.ok) {
    if (validation.kind === 'validation') {
      return { ok: false, response: withSensitiveNoStore(validationError(validation.message)) };
    }

    return { ok: false, response: withSensitiveNoStore(notFound(validation.message)) };
  }

  return { ok: true, grant: validation.grant };
}
