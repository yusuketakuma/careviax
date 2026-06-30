import { NextRequest } from 'next/server';
import { error, success, notFound } from '@/lib/api/response';
import { getClientIp } from '@/lib/api/request-ip';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import {
  buildExternalAccessPayload,
  recordExternalAccessViewed,
} from '@/server/services/external-access';
import { prepareExternalAccessOtpRequest, validatePreparedExternalAccessGrant } from '../shared';

/**
 * Public endpoint — no authentication required.
 * Validates token + OTP, returns scoped patient data.
 * OTP is read from the `x-otp` request header (not a URL query param).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const prepared = await prepareExternalAccessOtpRequest(req, rawToken);
  if (!prepared.ok) return prepared.response;

  const validation = await validatePreparedExternalAccessGrant(prepared.request);
  if (!validation.ok) return validation.response;

  const payload = await buildExternalAccessPayload(validation.grant);

  if (!payload) return withSensitiveNoStore(notFound('患者情報が見つかりません'));

  try {
    await recordExternalAccessViewed({
      grant: validation.grant,
      ipAddress: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
  } catch {
    return withSensitiveNoStore(
      error('EXTERNAL_ACCESS_VIEW_AUDIT_FAILED', '外部共有の閲覧監査を記録できませんでした', 500),
    );
  }
  return withSensitiveNoStore(success({ data: payload }));
}
