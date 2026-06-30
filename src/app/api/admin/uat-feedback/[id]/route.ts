import { unstable_rethrow } from 'next/navigation';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { z } from 'zod';

const updateUatFeedbackSchema = z.object({
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  status: z.enum(['open', 'triaged', 'in_progress', 'resolved', 'deferred']).optional(),
  owner_user_id: z.string().trim().min(1).nullable().optional(),
  linked_work_item: z.string().trim().max(200).nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
});

const authenticatedPATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('UAT フィードバックIDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateUatFeedbackSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updateResult = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.uatFeedback.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          priority: true,
          status: true,
          owner_user_id: true,
          linked_work_item: true,
          due_date: true,
          resolved_at: true,
        },
      });
      if (!existing) return { kind: 'not_found' as const };

      if (parsed.data.owner_user_id) {
        const owner = await tx.user.findFirst({
          where: { id: parsed.data.owner_user_id, org_id: ctx.orgId },
          select: { id: true },
        });
        if (!owner) return { kind: 'invalid_owner' as const };
      }

      const nextStatus = parsed.data.status;
      const resolvedAtUpdate =
        nextStatus === undefined
          ? {}
          : nextStatus === 'resolved' && existing.status !== 'resolved'
            ? { resolved_at: new Date() }
            : nextStatus !== 'resolved' && existing.status === 'resolved'
              ? { resolved_at: null }
              : {};

      const updated = await tx.uatFeedback.update({
        where: { id },
        data: {
          ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
          ...(nextStatus !== undefined ? { status: nextStatus } : {}),
          ...(parsed.data.owner_user_id !== undefined
            ? { owner_user_id: parsed.data.owner_user_id }
            : {}),
          ...(parsed.data.linked_work_item !== undefined
            ? { linked_work_item: parsed.data.linked_work_item }
            : {}),
          ...(parsed.data.due_date !== undefined
            ? { due_date: parsed.data.due_date ? new Date(parsed.data.due_date) : null }
            : {}),
          ...resolvedAtUpdate,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'uat_feedback_updated',
        targetType: 'UatFeedback',
        targetId: updated.id,
        changes: {
          previous: {
            priority: existing.priority,
            status: existing.status,
            owner_user_id: existing.owner_user_id,
            linked_work_item: existing.linked_work_item,
            due_date: existing.due_date?.toISOString() ?? null,
            resolved_at: existing.resolved_at?.toISOString() ?? null,
          },
          current: {
            priority: updated.priority,
            status: updated.status,
            owner_user_id: updated.owner_user_id,
            linked_work_item: updated.linked_work_item,
            due_date: updated.due_date?.toISOString() ?? null,
            resolved_at: updated.resolved_at?.toISOString() ?? null,
          },
        },
      });

      return { kind: 'updated' as const, feedback: updated };
    });
    if (updateResult.kind === 'not_found') {
      return notFound('UAT フィードバックが見つかりません');
    }
    if (updateResult.kind === 'invalid_owner') {
      return validationError('割当先ユーザーが見つかりません', {
        owner_user_id: ['同一組織のユーザーを指定してください'],
      });
    }
    const updated = updateResult.feedback;

    return success({
      data: {
        ...updated,
        checked_items: Array.isArray(updated.checked_items) ? updated.checked_items : [],
        due_date: updated.due_date?.toISOString() ?? null,
        resolved_at: updated.resolved_at?.toISOString() ?? null,
        created_at: updated.created_at.toISOString(),
        updated_at: updated.updated_at.toISOString(),
      },
    });
  },
  {
    permission: 'canAdmin',
    message: 'UAT フィードバックの更新権限がありません',
  },
);

export const PATCH: typeof authenticatedPATCH = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
