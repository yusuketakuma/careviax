import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { reviewBillingCandidate } from '@/server/services/billing-evidence';

const REVIEW_ACTIONS = ['confirm', 'exclude', 'reopen'] as const;
type ReviewAction = (typeof REVIEW_ACTIONS)[number];

function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === 'string' && REVIEW_ACTIONS.includes(value as ReviewAction);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '請求候補の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const candidateId = normalizeRequiredRouteParam(rawId);
  if (!candidateId) return validationError('請求候補IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const action = payload.action;
  if (!isReviewAction(action)) {
    return validationError('action は confirm / exclude / reopen のいずれかを指定してください');
  }

  const note = typeof payload.note === 'string' ? payload.note : null;

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const candidate = await tx.billingCandidate.findFirst({
      where: {
        id: candidateId,
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
      billingCandidateId: candidateId,
      action,
      note,
      actorId: ctx.userId,
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'billing_candidate_review_updated',
      targetType: 'BillingCandidate',
      targetId: candidateId,
      changes: {
        action,
        note,
        status_before: candidate.status,
        status_after: next.status,
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
