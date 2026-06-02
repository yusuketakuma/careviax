import { auth, getAuthAccessToken } from '@/lib/auth/config';
import { externalError, success, unauthorized, validationError } from '@/lib/api/response';
import { verifyTotpForAccessToken } from '@/server/services/cognito-auth';
import { issueMfaRecoveryCodes } from '@/server/services/mfa-recovery';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import type { NextRequest } from 'next/server';

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth>>>;

async function resolveCurrentUserId(session: AuthSession) {
  const sessionUserId = session.user?.id?.trim();
  const directUser = sessionUserId
    ? await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { id: true },
      })
    : null;

  if (directUser?.id) {
    return directUser.id;
  }

  const resolvedUser = await resolveLocalUserByIdentity({
    cognitoSub: session.user?.cognitoSub,
    email: session.user?.email,
  });

  return resolvedUser?.id ?? null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const accessToken = await getAuthAccessToken(req);
  if (!session || !accessToken) {
    return unauthorized();
  }

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) {
    return validationError('リクエストボディが不正です');
  }

  const code = typeof payload?.code === 'string' ? payload.code.trim() : '';
  if (!code) {
    return validationError('確認コードを入力してください');
  }

  const userId = await resolveCurrentUserId(session);

  try {
    await verifyTotpForAccessToken({
      accessToken,
      code,
      deviceName: 'PH-OS TOTP',
    });
  } catch {
    return externalError('EXTERNAL_MFA_VERIFY_FAILED', '確認コードが正しくありません', 400);
  }

  if (!userId) {
    return externalError('AUTH_USER_NOT_FOUND', 'ユーザー情報の取得に失敗しました', 404);
  }

  const recoveryCodes = await issueMfaRecoveryCodes(userId);

  return success({ ok: true, recoveryCodes });
}
