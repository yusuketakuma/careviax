import { NextResponse } from 'next/server';
import { z } from 'zod';
import { externalError, validationError } from '@/lib/api/response';
import { confirmForgotPassword } from '@/server/services/cognito-auth';

const schema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
  newPassword: z
    .string()
    .min(13)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[a-z]/, 'Must contain lowercase')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});

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
    return externalError(
      'EXTERNAL_PASSWORD_RESET_CONFIRM_FAILED',
      (error as Error).name === 'CodeMismatchException'
        ? '確認コードが正しくありません'
        : 'パスワードの再設定に失敗しました',
      400
    );
  }

  return NextResponse.json({ ok: true });
}
