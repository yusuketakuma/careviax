import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { reviewBillingCandidate } from '@/server/services/billing-evidence';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '請求候補の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const action = (body as { action?: string }).action;
  if (!['confirm', 'exclude', 'reopen'].includes(action ?? '')) {
    return validationError('action は confirm / exclude / reopen のいずれかを指定してください');
  }

  const note =
    typeof (body as { note?: unknown }).note === 'string'
      ? ((body as { note?: string }).note ?? null)
      : null;

  const { id } = await params;

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const candidate = await tx.billingCandidate.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        status: true,
      },
    });
    if (!candidate) return null;
    if (candidate.status === 'exported') {
      return 'closed' as const;
    }

    const next = await reviewBillingCandidate(tx, {
      orgId: ctx.orgId,
      billingCandidateId: id,
      action: action as 'confirm' | 'exclude' | 'reopen',
      note,
      actorId: ctx.userId,
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'billing_candidate_review_updated',
        target_type: 'BillingCandidate',
        target_id: id,
        changes: {
          action,
          note,
          status_before: candidate.status,
          status_after: next.status,
        },
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    return next;
  });

  if (!updated) {
    return notFound('請求候補が見つかりません');
  }
  if (updated === 'closed') {
    return conflict('月次締め済みの請求候補は更新できません');
  }

  return success({ data: updated });
}
