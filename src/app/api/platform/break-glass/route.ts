import type { NextRequest } from 'next/server';
import { BreakGlassScope } from '@prisma/client';
import { error, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { logger } from '@/lib/utils/logger';
import { requirePlatformOperator } from '@/lib/platform/operator';
import {
  BreakGlassAccessError,
  createBreakGlassSession,
  listActiveBreakGlassSessions,
  serializeBreakGlassSession,
} from '@/lib/platform/break-glass';
import { verifyBreakGlassStepUp } from '@/lib/platform/step-up-mfa';

const MIN_REASON_LENGTH = 10;

/** Lists the operator's currently-active break-glass sessions. */
export async function GET(req: NextRequest) {
  const guard = await requirePlatformOperator(req);
  if ('response' in guard) return guard.response;
  const sessions = await listActiveBreakGlassSessions(guard.operator.operatorId);
  return withSensitiveNoStore(success({ sessions: sessions.map(serializeBreakGlassSession) }));
}

/**
 * Activates a break-glass session after full step-up re-authentication
 * (password + TOTP). Body: { targetOrgId, reason, referenceTicket?, scope?,
 * password, mfaCode }.
 */
export async function POST(req: NextRequest) {
  const guard = await requirePlatformOperator(req);
  if ('response' in guard) return guard.response;
  const { operator } = guard;

  const body = await readJsonObjectRequestBody(req);
  if (!body) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const targetOrgId = typeof body.targetOrgId === 'string' ? body.targetOrgId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const mfaCode = typeof body.mfaCode === 'string' ? body.mfaCode.trim() : '';
  const referenceTicket =
    typeof body.referenceTicket === 'string' && body.referenceTicket.trim()
      ? body.referenceTicket.trim()
      : undefined;
  const scope =
    body.scope === 'read_write' ? BreakGlassScope.read_write : BreakGlassScope.read_only;

  if (!targetOrgId) return withSensitiveNoStore(validationError('対象テナントを指定してください'));
  if (reason.length < MIN_REASON_LENGTH) {
    return withSensitiveNoStore(validationError('アクセス理由を10文字以上で入力してください'));
  }
  if (!password || !mfaCode) {
    return withSensitiveNoStore(validationError('再認証のためパスワードとMFAコードを入力してください'));
  }

  const reauthenticated = await verifyBreakGlassStepUp({
    email: operator.email,
    password,
    code: mfaCode,
  });
  if (!reauthenticated) {
    logger.warn({ event: 'break_glass_stepup_failed', actorId: operator.userId });
    return withSensitiveNoStore(
      error('BREAK_GLASS_REAUTH_FAILED', '再認証に失敗しました', 401),
    );
  }

  try {
    const session = await createBreakGlassSession({
      operator,
      targetOrgId,
      reason,
      referenceTicket,
      scope,
      mfaVerifiedAt: new Date(),
    });
    return withSensitiveNoStore(success({ session: serializeBreakGlassSession(session) }, 201));
  } catch (err) {
    if (err instanceof BreakGlassAccessError) {
      const status = err.code === 'scope_denied' ? 403 : 400;
      return withSensitiveNoStore(error('BREAK_GLASS_DENIED', err.message, status));
    }
    throw err;
  }
}

// Non-operators must never reach this route with a cached response.
export const dynamic = 'force-dynamic';
