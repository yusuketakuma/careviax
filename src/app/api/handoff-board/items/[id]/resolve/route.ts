import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

/**
 * 薬剤師に相談 / 事務へ戻す(p0_27)— 相談解決フロー。
 * 事務員から薬剤師に渡った相談(consult_status 付き HandoffItem)に対して、
 * 薬剤師が「薬剤師の対応」を記録する。3 アクションそれぞれが
 * consult_status を遷移させる:
 *   - acknowledged(内容を確認した)        → consult_status = checking(確認中)
 *   - escalated_to_physician(医師へ確認する) → consult_status = checking(確認中・医師確認待ち)
 *   - returned_to_clerk(事務へ戻す)         → consult_status = returned_to_clerk(事務へ戻し)
 * いずれも resolution_action / resolution_note / resolved_by / resolved_at を記録し、
 * 監査ログ(audit-by-default)に残す。
 */

const resolutionActionSchema = z.enum([
  'acknowledged',
  'escalated_to_physician',
  'returned_to_clerk',
]);

const resolveSchema = z
  .object({
    resolution_action: resolutionActionSchema,
    resolution_note: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, refinementCtx) => {
    // 事務へ戻す場合は事務員への指示メモを必須にする(言った/聞いてないを防ぐ)。
    if (value.resolution_action === 'returned_to_clerk' && !value.resolution_note) {
      refinementCtx.addIssue({
        code: 'custom',
        path: ['resolution_note'],
        message: '事務へ戻す時はメモ(指示内容)が必須です',
      });
    }
  });

/** 薬剤師の対応 → 相談の状態の遷移。 */
const NEXT_CONSULT_STATUS: Record<z.infer<typeof resolutionActionSchema>, string> = {
  acknowledged: 'checking',
  escalated_to_physician: 'checking',
  returned_to_clerk: 'returned_to_clerk',
};

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id } = await routeContext.params;

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = resolveSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const item = await prisma.handoffItem.findFirst({
      where: { id },
      include: {
        board: {
          select: { org_id: true },
        },
      },
    });
    if (!item || item.board.org_id !== ctx.orgId) {
      return notFound('相談が見つかりません');
    }

    const resolutionAction = parsed.data.resolution_action;
    const nextConsultStatus = NEXT_CONSULT_STATUS[resolutionAction];
    const resolutionNote = parsed.data.resolution_note ?? null;
    const resolvedAt = new Date();

    const updated = await withOrgContext(ctx.orgId, async (tx) => {
      const result = await tx.handoffItem.update({
        where: { id },
        data: {
          consult_status: nextConsultStatus,
          resolution_action: resolutionAction,
          resolution_note: resolutionNote,
          resolved_by: ctx.userId,
          resolved_at: resolvedAt,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'handoff_consult_resolved',
        targetType: 'handoff_item',
        targetId: id,
        changes: {
          consult_status: nextConsultStatus,
          resolution_action: resolutionAction,
          resolution_note: resolutionNote,
          resolved_at: resolvedAt.toISOString(),
        },
      });

      return result;
    });

    return success({ data: updated });
  },
  {
    permission: 'canDispense',
    message: '相談に対応する権限がありません',
  },
);
