import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { externalError, unauthorized } from '@/lib/api/response';
import { disableTotpForAccessToken } from '@/server/services/cognito-auth';

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) {
    return unauthorized();
  }

  try {
    await disableTotpForAccessToken(session.accessToken);
  } catch {
    return externalError('EXTERNAL_MFA_DISABLE_FAILED', 'MFAの無効化に失敗しました', 400);
  }

  return NextResponse.json({ ok: true });
}
