import { z } from 'zod';
import { externalError, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { clearMfaRecoveryCodes, verifyMfaRecoveryCode } from '@/server/services/mfa-recovery';
import { disableCognitoTotpForUser } from '@/server/services/cognito-admin';

const recoverySchema = z.object({
  email: z.string().email('メールアドレス形式が不正です'),
  recoveryCode: z.string().min(1, 'リカバリーコードを入力してください'),
});

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { email?: string; recoveryCode?: string }
    | null;
  if (!body) {
    return validationError('リクエストボディが不正です');
  }

  const parsed = recoverySchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.trim().toLowerCase() },
    select: {
      id: true,
      email: true,
      cognito_username: true,
    },
  });

  if (!user) {
    return externalError('AUTH_RECOVERY_CODE_INVALID', 'リカバリーコードが正しくありません', 400);
  }

  const isValidRecoveryCode = await verifyMfaRecoveryCode(user.id, parsed.data.recoveryCode);
  if (!isValidRecoveryCode) {
    return externalError('AUTH_RECOVERY_CODE_INVALID', 'リカバリーコードが正しくありません', 400);
  }

  try {
    await disableCognitoTotpForUser(user.cognito_username ?? user.email);
    await clearMfaRecoveryCodes(user.id);
  } catch {
    return externalError('EXTERNAL_MFA_RECOVERY_FAILED', 'MFAリカバリー処理に失敗しました', 502);
  }

  return Response.json({
    ok: true,
    message: 'リカバリーコードを確認しました。再ログイン後にMFAを再設定してください。',
  });
}
