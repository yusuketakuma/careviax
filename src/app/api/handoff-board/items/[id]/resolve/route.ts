import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  success,
  validationError,
  notFound,
  conflict,
  internalError,
  forbidden,
} from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
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

const authenticatedPOST = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('相談IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = resolveSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const item = await prisma.handoffItem.findFirst({
      where: { id, board: { org_id: ctx.orgId } },
      select: { id: true, consult_status: true, recipient_user_id: true },
    });
    if (!item) {
      return notFound('相談が見つかりません');
    }
    if (item.recipient_user_id !== ctx.userId) {
      return forbidden('この相談に対応する権限がありません');
    }
    // consult_status が null の行は従来の引き継ぎ/作業移譲アイテム（相談ではない）。
    // 相談解決エンドポイントで誤って consult 化しないようガードする。
    if (item.consult_status === null) {
      return validationError('この項目は相談ではないため解決できません');
    }

    const resolutionAction = parsed.data.resolution_action;
    const nextConsultStatus = NEXT_CONSULT_STATUS[resolutionAction];
    const resolutionNote = parsed.data.resolution_note ?? null;
    const resolvedAt = new Date();

    const updated = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const claim = await tx.handoffItem.updateMany({
          where: {
            id,
            board: { org_id: ctx.orgId },
            recipient_user_id: ctx.userId,
            consult_status: item.consult_status,
            resolution_action: null,
            resolved_at: null,
          },
          data: {
            consult_status: nextConsultStatus,
            resolution_action: resolutionAction,
            resolution_note: resolutionNote,
            resolved_by: ctx.userId,
            resolved_at: resolvedAt,
          },
        });
        if (claim.count !== 1) {
          return { error: 'state_changed' as const };
        }

        const result = await tx.handoffItem.findFirst({
          where: { id, board: { org_id: ctx.orgId }, recipient_user_id: ctx.userId },
          select: {
            id: true,
            consult_status: true,
            resolution_action: true,
            resolved_by: true,
            resolved_at: true,
          },
        });
        if (!result) {
          return { error: 'state_changed' as const };
        }

        await createAuditLogEntry(tx, ctx, {
          action: 'handoff_consult_resolved',
          targetType: 'handoff_item',
          targetId: id,
          changes: {
            consult_status: nextConsultStatus,
            resolution_action: resolutionAction,
            resolution_note_present: resolutionNote != null,
            resolution_note_length: resolutionNote?.length ?? 0,
            resolution_note_redacted: resolutionNote != null,
            resolved_at: resolvedAt.toISOString(),
          },
        });

        return result;
      },
      { requestContext: ctx },
    );

    if ('error' in updated) {
      return conflict('この相談は他のユーザーによって更新されています。再読み込みしてください');
    }

    return success({ data: updated });
  },
  {
    // 相談の「対応」は薬剤師の臨床判断(acknowledged/医師へ確認/事務へ戻す)であり、
    // 事務(clerk)は起票はできても対応はできない。canReport ではなく canAuthorReport
    // (薬剤師の専門的書き込み: clerk=false / pharmacist=true)でゲートする。
    permission: 'canAuthorReport',
    message: '相談に対応する権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
