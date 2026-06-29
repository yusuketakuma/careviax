import { unstable_rethrow } from 'next/navigation';
import { NextRequest, type NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { reviewBillingCandidate } from '@/server/services/billing-evidence';
import { z } from 'zod';

const REVIEW_ACTIONS = ['confirm', 'exclude', 'reopen'] as const;

const reviewBillingCandidateSchema = z.object({
  action: z.enum(REVIEW_ACTIONS, {
    error: 'action は confirm / exclude / reopen のいずれかを指定してください',
  }),
  expected_updated_at: z.string().datetime('版情報が不正です'),
  note: z.string().nullable().optional(),
});

function isBillingCandidateStaleError(error: unknown) {
  return error instanceof Error && error.message === 'BILLING_CANDIDATE_STALE';
}

async function authenticatedPATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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

  const parsed = reviewBillingCandidateSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { action, expected_updated_at: expectedUpdatedAtRaw } = parsed.data;
  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
  const note = typeof parsed.data.note === 'string' ? parsed.data.note : null;

  let updated;
  try {
    updated = await withOrgContext(ctx.orgId, async (tx) => {
      const candidate = await tx.billingCandidate.findFirst({
        where: {
          id: candidateId,
          org_id: ctx.orgId,
        },
        select: {
          id: true,
          status: true,
          updated_at: true,
        },
      });
      if (!candidate) return null;
      if (candidate.status === 'exported') {
        return 'closed' as const;
      }
      if (candidate.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
        return 'stale' as const;
      }

      const next = await reviewBillingCandidate(tx, {
        orgId: ctx.orgId,
        billingCandidateId: candidateId,
        action,
        note,
        actorId: ctx.userId,
        expectedUpdatedAt,
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
  } catch (error) {
    if (isBillingCandidateStaleError(error)) {
      return conflict(
        '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
      );
    }
    throw error;
  }

  if (!updated) {
    return notFound('請求候補が見つかりません');
  }
  if (updated === 'closed') {
    return conflict('月次締め済みの請求候補は更新できません');
  }
  if (updated === 'stale') {
    return conflict(
      '請求候補が他のユーザーによって更新されています。最新のデータを取得してください。',
    );
  }

  return success({ data: updated });
}

export async function PATCH(
  req: NextRequest,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
