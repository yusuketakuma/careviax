import { z } from 'zod';
import { externalError, validationError, error } from '@/lib/api/response';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  clearMfaRecoveryCodes,
  MfaRecoveryConfigError,
  restoreMfaRecoveryCodes,
  takeMfaRecoveryCodesForRecovery,
} from '@/server/services/mfa-recovery';
import { disableCognitoTotpForUser } from '@/server/services/cognito-admin';
import { logger } from '@/lib/utils/logger';

const recoverySchema = z.object({
  email: z.string().trim().email('メールアドレス形式が不正です'),
  recoveryCode: z.string().trim().min(1, 'リカバリーコードを入力してください'),
});

export async function POST(req: Request) {
  const ip = getClientIp(req) ?? 'unknown';
  const rateLimit = await checkAuthRateLimit(ip, '/api/auth/mfa/recovery');
  if (!rateLimit.allowed) {
    return error('RATE_LIMIT_EXCEEDED', 'Too many requests', 429);
  }

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) {
    return validationError('リクエストボディが不正です');
  }

  const parsed = recoverySchema.safeParse(payload);
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
    recoverySnapshot = await takeMfaRecoveryCodesForRecovery(user.id, parsed.data.recoveryCode);
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
      logger.error(
        {
          event: 'auth_mfa_recovery_restore_failed',
          route: '/api/auth/mfa/recovery',
          method: 'POST',
          operation: 'restore_recovery_codes_after_cognito_error',
        },
        restoreError,
      );
    });
    return externalError('EXTERNAL_MFA_RECOVERY_FAILED', 'MFAリカバリー処理に失敗しました', 502);
  }

  return Response.json({
    ok: true,
    message: 'リカバリーコードを確認しました。再ログイン後にMFAを再設定してください。',
  });
}
