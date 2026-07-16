import { z } from 'zod';
import { externalError, registeredError, success, validationError } from '@/lib/api/response';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  confirmForgotPasswordAndRevokeSessions,
  CredentialRevocationPendingError,
} from '@/server/services/credential-revocation';

const schema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(1),
  newPassword: z
    .string()
    .trim()
    .min(13)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[a-z]/, 'Must contain lowercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});

function classifyPasswordResetConfirmError(error: unknown) {
  const name = error instanceof Error ? error.name : '';

  if (name === 'CodeMismatchException' || name === 'ExpiredCodeException') {
    return {
      message:
        name === 'ExpiredCodeException'
          ? '確認コードの有効期限が切れています'
          : '確認コードが正しくありません',
      status: 400,
    };
  }

  if (name === 'InvalidPasswordException' || name === 'InvalidParameterException') {
    return {
      message: '新しいパスワードが要件を満たしていません',
      status: 400,
    };
  }

  if (name === 'LimitExceededException' || name === 'TooManyRequestsException') {
    return {
      message: '試行回数が多すぎます。時間をおいて再試行してください',
      status: 429,
    };
  }

  return {
    message: 'パスワードの再設定に失敗しました',
    status: 502,
  };
}

export async function POST(req: Request) {
  const ip = getClientIp(req) ?? 'unknown';
  const rateLimit = await checkAuthRateLimit(ip, '/api/auth/password/reset/confirm');
  if (!rateLimit.allowed) {
    return registeredError('RATE_LIMIT_EXCEEDED', 'Too many requests');
  }

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    return validationError(
      'メールアドレス、確認コード、新しいパスワードを入力してください',
      parsed.error.flatten().fieldErrors,
    );
  }

  const { email, code, newPassword } = parsed.data;

  try {
    await confirmForgotPasswordAndRevokeSessions({
      email,
      code,
      newPassword,
      actor: {
        ipAddress: ip === 'unknown' ? null : ip,
        userAgent: req.headers.get('user-agent') ?? undefined,
      },
    });
  } catch (error) {
    if (error instanceof CredentialRevocationPendingError) {
      return externalError(
        'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
        'パスワードの再設定処理を完了できませんでした',
        503,
      );
    }
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      return externalError(
        'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
        '確認コードが正しくありません',
        400,
      );
    }
    const classified = classifyPasswordResetConfirmError(error);
    return externalError(
      'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
      classified.message,
      classified.status,
    );
  }

  return success({ data: { ok: true } });
}
