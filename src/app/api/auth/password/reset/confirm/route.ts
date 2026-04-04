import { NextResponse } from 'next/server';
import { z } from 'zod';
import { externalError, validationError } from '@/lib/api/response';
import { confirmForgotPassword } from '@/server/services/cognito-auth';

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
      message: name === 'ExpiredCodeException' ? '確認コードの有効期限が切れています' : '確認コードが正しくありません',
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
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return validationError(
      'メールアドレス、確認コード、新しいパスワードを入力してください',
      parsed.error.flatten().fieldErrors
    );
  }

  const { email, code, newPassword } = parsed.data;

  try {
    await confirmForgotPassword({
      email,
      code,
      newPassword,
    });
  } catch (error) {
    const classified = classifyPasswordResetConfirmError(error);
    return externalError(
      'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
      classified.message,
      classified.status
    );
  }

  return NextResponse.json({ ok: true });
}
