import { NextRequest, NextResponse } from 'next/server';
import { getAuthAccessToken } from '@/lib/auth/config';
import { conflict, externalError, unauthorized, validationError } from '@/lib/api/response';
import {
  changePasswordAndRevokeSessions,
  CredentialRevocationPendingError,
} from '@/server/services/credential-revocation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withAuthContext } from '@/lib/auth/context';

export const PATCH = withAuthContext(async (req: NextRequest, ctx) => {
  const accessToken = await getAuthAccessToken(req);
  if (!accessToken) {
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
    await changePasswordAndRevokeSessions({
      userId: ctx.userId,
      accessToken,
      currentPassword,
      newPassword,
      actor: {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        correlationId: ctx.correlationId,
      },
    });
  } catch (error) {
    if (error instanceof CredentialRevocationPendingError) {
      return conflict('セッション失効処理が進行中です。再度ログインしてください');
    }
    return externalError(
      'EXTERNAL_PASSWORD_CHANGE_FAILED',
      error instanceof Error && error.name === 'NotAuthorizedException'
        ? '現在のパスワードが正しくありません'
        : 'パスワードの変更に失敗しました',
      error instanceof Error && error.name === 'NotAuthorizedException' ? 400 : 502,
    );
  }

  return NextResponse.json({ ok: true });
});
