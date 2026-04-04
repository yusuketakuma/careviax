import { NextRequest, NextResponse } from 'next/server';
import { auth, getAuthAccessToken } from '@/lib/auth/config';
import { externalError, unauthorized } from '@/lib/api/response';
import { associateTotpForAccessToken } from '@/server/services/cognito-auth';

export async function POST(request: NextRequest) {
  const session = await auth();
  const accessToken = await getAuthAccessToken(request);
  if (!session?.user?.email || !accessToken) {
    return unauthorized();
  }

  try {
    const result = await associateTotpForAccessToken(accessToken);
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
