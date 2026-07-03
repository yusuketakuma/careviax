import type { NextRequest } from 'next/server';
import { notFound, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { requirePlatformOperator } from '@/lib/platform/operator';
import {
  revokeBreakGlassSession,
  serializeBreakGlassSession,
} from '@/lib/platform/break-glass';

/** Revokes a break-glass session (own session, or any session for platform_owner). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requirePlatformOperator(req);
  if ('response' in guard) return guard.response;

  const { id } = await params;
  const revoked = await revokeBreakGlassSession(guard.operator, id);
  if (!revoked) {
    return withSensitiveNoStore(notFound('対象のブレークグラスセッションが見つかりません'));
  }
  return withSensitiveNoStore(success({ session: serializeBreakGlassSession(revoked) }));
}

export const dynamic = 'force-dynamic';
