import { z } from 'zod';
import { error, externalError, validationError } from '@/lib/api/response';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';
import { startForgotPassword } from '@/server/services/cognito-auth';

const requestPasswordResetSchema = z.object({
  email: z.string().trim().email('メールアドレス形式が不正です'),
});

function successResponse() {
  return Response.json({
    ok: true,
    message:
      'アカウントが存在する場合、確認コードの案内を送信しました。',
  });
}

export async function POST(req: Request) {
  const ip = getClientIp(req) ?? 'unknown';
  const rateLimit = await checkAuthRateLimit(ip, '/api/auth/password/reset/request');
  if (!rateLimit.allowed) {
    return error('RATE_LIMIT_EXCEEDED', 'Too many requests', 429);
  }

  const body = await req.json().catch(() => null);
  const parsed = requestPasswordResetSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('メールアドレスを入力してください', parsed.error.flatten().fieldErrors);
  }

  try {
    await startForgotPassword(parsed.data.email);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';
    if (
      errorName === 'UserNotFoundException' ||
      errorName === 'LimitExceededException' ||
      errorName === 'TooManyRequestsException'
    ) {
      return successResponse();
    }

    return externalError(
      'EXTERNAL_PASSWORD_RESET_REQUEST_FAILED',
      '確認コードの送信に失敗しました',
      502
    );
  }

  return successResponse();
}
