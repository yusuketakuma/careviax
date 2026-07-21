import { NextRequest, NextResponse } from 'next/server';
import { auth, getAuthAccessToken } from '@/lib/auth/config';
import { registeredExternalError, unauthorized } from '@/lib/api/response';
import { disableTotpForAccessToken } from '@/server/services/cognito-auth';

export async function DELETE(request: NextRequest) {
  const session = await auth();
  const accessToken = await getAuthAccessToken(request);
  if (!session || !accessToken) {
    return unauthorized();
  }

  try {
    await disableTotpForAccessToken(accessToken);
  } catch {
    return registeredExternalError('EXTERNAL_MFA_DISABLE_FAILED', 'MFAの無効化に失敗しました');
  }

  return NextResponse.json({ ok: true });
}
