import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { externalError, unauthorized } from '@/lib/api/response';
import { associateTotpForAccessToken } from '@/server/services/cognito-auth';

export async function POST() {
  const session = await auth();
  if (!session?.accessToken || !session.user?.email) {
    return unauthorized();
  }

  try {
    const result = await associateTotpForAccessToken(session.accessToken);
    if (!result.SecretCode) {
      throw new Error('MFA_SECRET_MISSING');
    }

    return NextResponse.json({
      secretCode: result.SecretCode,
      otpauthUri: `otpauth://totp/CareViaX:${encodeURIComponent(
        session.user.email
      )}?secret=${result.SecretCode}&issuer=${encodeURIComponent('CareViaX')}`,
    });
  } catch {
    return externalError(
      'EXTERNAL_MFA_SETUP_FAILED',
      'MFA設定情報の取得に失敗しました',
      400
    );
  }
}
