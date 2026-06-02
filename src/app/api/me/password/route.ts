import { NextRequest, NextResponse } from 'next/server';
import { auth, getAuthAccessToken } from '@/lib/auth/config';
import { externalError, unauthorized, validationError } from '@/lib/api/response';
import { changePasswordWithAccessToken } from '@/server/services/cognito-auth';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const accessToken = await getAuthAccessToken(req);
  if (!session || !accessToken) {
    return unauthorized();
  }

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) {
    return validationError('リクエストボディが不正です');
  }

  const currentPassword =
    typeof payload.currentPassword === 'string' ? payload.currentPassword.trim() : '';
  const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword.trim() : '';

  if (!currentPassword || !newPassword) {
    return validationError('現在のパスワードと新しいパスワードを入力してください');
  }

  if (newPassword.length < 13) {
    return validationError('新しいパスワードは13文字以上で入力してください');
  }

  try {
    await changePasswordWithAccessToken({
      accessToken,
      currentPassword,
      newPassword,
    });
  } catch (error) {
    return externalError(
      'EXTERNAL_PASSWORD_CHANGE_FAILED',
      (error as Error).name === 'NotAuthorizedException'
        ? '現在のパスワードが正しくありません'
        : 'パスワードの変更に失敗しました',
      400,
    );
  }

  return NextResponse.json({ ok: true });
}
