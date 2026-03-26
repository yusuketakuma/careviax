import { NextRequest } from 'next/server';
import { success, notFound, validationError } from '@/lib/api/response';
import {
  buildExternalAccessPayload,
  markExternalAccessViewed,
  validateExternalAccessGrant,
} from '@/server/services/external-access';

/**
 * Public endpoint — no authentication required.
 * Validates token + OTP, returns scoped patient data.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const otpParam = req.nextUrl.searchParams.get('otp');
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
