import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { notFound, registeredError, validationError } from '@/lib/api/response';
import {
  checkAuthRateLimit,
  checkExternalAccessOtpLockout,
  recordExternalAccessOtpFailure,
} from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateExternalAccessGrant } from '@/server/services/external-access';

export const EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH = '/api/external-access/otp';
const EXTERNAL_ACCESS_OTP_LOCKOUT_HASH_DOMAIN = 'ph-os:external-access-otp-lockout:v1';

export function createExternalAccessOtpRateLimitIdentifier(token: string, ipAddress: string) {
  return createHash('sha256').update(`${token}:${ipAddress}`).digest('hex');
}

export function createExternalAccessOtpLockoutIdentifier(token: string) {
  return createHash('sha256')
    .update(EXTERNAL_ACCESS_OTP_LOCKOUT_HASH_DOMAIN)
    .update('\0')
    .update(token)
    .digest('hex');
}

function externalAccessOtpLockoutUnavailableResponse() {
  return withSensitiveNoStore(registeredError('INTERNAL_ERROR', '外部共有を確認できませんでした'));
}

function externalAccessOtpLockedResponse() {
  return withSensitiveNoStore(notFound('共有リンクが無効または期限切れです'));
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
        registeredError(
          'RATE_LIMIT_EXCEEDED',
          'リクエストが多すぎます。しばらく待ってから再試行してください。',
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
    if (validation.failure === 'otp_mismatch') {
      const lockout = await recordExternalAccessOtpFailure(
        createExternalAccessOtpLockoutIdentifier(prepared.token),
      );
      if (!lockout.available) {
        return { ok: false, response: externalAccessOtpLockoutUnavailableResponse() };
      }
      if (lockout.locked) {
        return { ok: false, response: externalAccessOtpLockedResponse() };
      }
    }

    if (validation.kind === 'validation') {
      return { ok: false, response: withSensitiveNoStore(validationError(validation.message)) };
    }

    return { ok: false, response: withSensitiveNoStore(notFound(validation.message)) };
  }

  const lockout = await checkExternalAccessOtpLockout(
    createExternalAccessOtpLockoutIdentifier(prepared.token),
  );
  if (!lockout.available) {
    return { ok: false, response: externalAccessOtpLockoutUnavailableResponse() };
  }
  if (lockout.locked) {
    return { ok: false, response: externalAccessOtpLockedResponse() };
  }

  return { ok: true, grant: validation.grant };
}
