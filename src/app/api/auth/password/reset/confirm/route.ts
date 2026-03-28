import { NextResponse } from 'next/server';
import { externalError, validationError } from '@/lib/api/response';
import { confirmForgotPassword } from '@/server/services/cognito-auth';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { email?: string; code?: string; newPassword?: string }
    | null;

  const email = body?.email?.trim();
  const code = body?.code?.trim();
  const newPassword = body?.newPassword?.trim();

  if (!email || !code || !newPassword) {
    return validationError('メールアドレス、確認コード、新しいパスワードを入力してください');
  }

  if (newPassword.length < 13) {
    return validationError('新しいパスワードは13文字以上で入力してください');
  }

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
