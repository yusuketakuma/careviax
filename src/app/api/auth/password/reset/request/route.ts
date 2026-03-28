import { NextResponse } from 'next/server';
import { externalError, validationError } from '@/lib/api/response';
import { startForgotPassword } from '@/server/services/cognito-auth';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim();

  if (!email) {
    return validationError('メールアドレスを入力してください');
  }

  try {
    await startForgotPassword(email);
  } catch (error) {
    return externalError(
      'EXTERNAL_PASSWORD_RESET_REQUEST_FAILED',
      (error as Error).name === 'UserNotFoundException'
        ? '対象のメールアドレスが見つかりません'
        : '確認コードの送信に失敗しました',
      400
    );
  }

  return NextResponse.json({ ok: true });
}
