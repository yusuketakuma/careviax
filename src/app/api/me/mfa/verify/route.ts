import { auth } from '@/lib/auth/config';
import { externalError, success, unauthorized, validationError } from '@/lib/api/response';
import { verifyTotpForAccessToken } from '@/server/services/cognito-auth';
import { issueMfaRecoveryCodes } from '@/server/services/mfa-recovery';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';

async function resolveCurrentUserId() {
  const session = await auth();
  if (!session?.accessToken) {
    return { session, userId: null as string | null };
  }

  const sessionUserId = session.user?.id?.trim();
  const directUser = sessionUserId
    ? await prisma.user.findUnique({
        where: { id: sessionUserId },
      select: { id: true },
      })
    : null;

  if (directUser?.id) {
    return { session, userId: directUser.id };
  }

  const resolvedUser = await resolveLocalUserByIdentity({
    cognitoSub: session.user?.cognitoSub,
    email: session.user?.email,
  });

  return { session, userId: resolvedUser?.id ?? null };
}

export async function POST(req: Request) {
  const { session, userId } = await resolveCurrentUserId();
  if (!session?.accessToken) {
    return unauthorized();
  }

  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();
  if (!code) {
    return validationError('確認コードを入力してください');
  }

  try {
    await verifyTotpForAccessToken({
      accessToken: session.accessToken,
      code,
      deviceName: 'CareViaX TOTP',
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
