import type { NextRequest } from 'next/server';
import { forbiddenResponse, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { requirePlatformOperator } from '@/lib/platform/operator';
import { getActiveBreakGlassSession, withBreakGlassOrgContext } from '@/lib/platform/break-glass';
import {
  BREAK_GLASS_ACTIVATE_ACTION,
  BREAK_GLASS_READ_ACTION,
  BREAK_GLASS_REVOKE_ACTION,
  BREAK_GLASS_WRITE_ACTION,
} from '@/lib/audit/break-glass-audit';

const BREAK_GLASS_ACTIONS = [
  BREAK_GLASS_ACTIVATE_ACTION,
  BREAK_GLASS_REVOKE_ACTION,
  BREAK_GLASS_READ_ACTION,
  BREAK_GLASS_WRITE_ACTION,
];

const AUDIT_PAGE_SIZE = 100;

/**
 * Break-glass access history for one tenant (who accessed what, when, why).
 * Requires an active break-glass session for `orgId`; the query runs under RLS
 * scoped to that tenant, and viewing the log is itself recorded as a
 * break_glass_read audit row (transparency).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const guard = await requirePlatformOperator(req);
  if ('response' in guard) return guard.response;
  const { operator } = guard;

  const { orgId } = await params;
  const session = await getActiveBreakGlassSession(operator.operatorId, orgId);
  if (!session) {
    return withSensitiveNoStore(
      await forbiddenResponse('このテナントの有効なブレークグラスセッションがありません'),
    );
  }

  const rows = await withBreakGlassOrgContext(
    operator,
    session,
    { targetType: 'break_glass_audit', targetId: orgId, metadata: { view: 'audit' } },
    (tx) =>
      tx.auditLog.findMany({
        where: { action: { in: BREAK_GLASS_ACTIONS } },
        orderBy: { created_at: 'desc' },
        take: AUDIT_PAGE_SIZE,
        select: {
          id: true,
          actor_id: true,
          action: true,
          target_type: true,
          target_id: true,
          changes: true,
          ip_address: true,
          created_at: true,
        },
      }),
  );

  const entries = rows.map((r) => ({
    id: r.id,
    actor_id: r.actor_id,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    changes: r.changes,
    ip_address: r.ip_address,
    created_at: r.created_at.toISOString(),
  }));

  return withSensitiveNoStore(
    success({ entries, truncated: entries.length === AUDIT_PAGE_SIZE }),
  );
}

export const dynamic = 'force-dynamic';
