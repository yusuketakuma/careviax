import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { externalError, unauthorized, validationError } from '@/lib/api/response';
import { changePasswordWithAccessToken } from '@/server/services/cognito-auth';

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return unauthorized();
  }

  const body = (await req.json().catch(() => null)) as
    | { currentPassword?: string; newPassword?: string }
    | null;
  if (!body) {
    return validationError('リクエストボディが不正です');
  }

  const currentPassword = body.currentPassword?.trim();
  const newPassword = body.newPassword?.trim();

  if (!currentPassword || !newPassword) {
    return validationError('現在のパスワードと新しいパスワードを入力してください');
  }

  if (newPassword.length < 13) {
    return validationError('新しいパスワードは13文字以上で入力してください');
  }

  try {
    await changePasswordWithAccessToken({
      accessToken: session.accessToken,
      currentPassword,
      newPassword,
    });
  } catch (error) {
    return externalError(
      'EXTERNAL_PASSWORD_CHANGE_FAILED',
      (error as Error).name === 'NotAuthorizedException'
        ? '現在のパスワードが正しくありません'
        : 'パスワードの変更に失敗しました',
      400
    );
  }

  return NextResponse.json({ ok: true });
}
