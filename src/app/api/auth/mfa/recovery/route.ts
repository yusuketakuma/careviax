import { z } from 'zod';
import { externalError, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  clearMfaRecoveryCodes,
  MfaRecoveryConfigError,
  restoreMfaRecoveryCodes,
  takeMfaRecoveryCodesForRecovery,
} from '@/server/services/mfa-recovery';
import { disableCognitoTotpForUser } from '@/server/services/cognito-admin';

const recoverySchema = z.object({
  email: z.string().trim().email('メールアドレス形式が不正です'),
  recoveryCode: z.string().trim().min(1, 'リカバリーコードを入力してください'),
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

  let recoverySnapshot;
  try {
    recoverySnapshot = await takeMfaRecoveryCodesForRecovery(
      user.id,
      parsed.data.recoveryCode,
    );
  } catch (error) {
    if (error instanceof MfaRecoveryConfigError) {
      return externalError('EXTERNAL_MFA_RECOVERY_FAILED', 'MFAリカバリー設定が未完了です', 503);
    }
    throw error;
  }
  if (!recoverySnapshot) {
    return externalError('AUTH_RECOVERY_CODE_INVALID', 'リカバリーコードが正しくありません', 400);
  }

  try {
    await disableCognitoTotpForUser(user.cognito_username ?? user.email);
    await clearMfaRecoveryCodes(user.id);
  } catch {
    await restoreMfaRecoveryCodes(user.id, recoverySnapshot).catch((restoreError) => {
      console.error('[mfa-recovery] Failed to restore recovery codes after Cognito error', restoreError);
    });
    return externalError('EXTERNAL_MFA_RECOVERY_FAILED', 'MFAリカバリー処理に失敗しました', 502);
  }

  return Response.json({
    ok: true,
    message: 'リカバリーコードを確認しました。再ログイン後にMFAを再設定してください。',
  });
}
