import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

/**
 * ハンドオフ項目の作成。
 * new_12_handoff: 宛先(recipient)付きの「仕事を渡す」は責任の移転として扱い、
 * 3点セット ①何を(scope) ②なぜ(rationale) ③いつまで(deadline) が
 * 揃わないと送信できない。p0_27 の薬剤師相談は consult_status 付き item として扱う。
 */

const lifecycleStatusSchema = z.enum(['proposed', 'in_progress', 'confirming', 'completed']);

// 相談の状態(p0_27 薬剤師に相談)。事務員が相談を起票すると open で入る。
const consultStatusSchema = z.enum(['open', 'checking', 'returned_to_clerk', 'resolved']);

const createHandoffItemSchema = z
  .object({
    board_id: z.string().trim().min(1, 'board_idは必須です'),
    content: z.string().trim().min(1, '内容は必須です').max(4000),
    priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
    entity_type: z.string().trim().max(100).optional(),
    entity_id: z.string().trim().max(100).optional(),
    // 種別。未指定時は従来どおり推論(consult_status あり=相談 / 宛先あり=責任移転)。
    // 'message' は3点セット不要の薬局内フリー連絡(伝言)。
    kind: z.enum(['transfer', 'consult', 'message']).optional(),
    // --- 責任移転(仕事を渡す)用の拡張フィールド ---
    recipient_user_id: z.string().trim().min(1).max(100).optional(),
    recipient_label: z.string().trim().min(1, '宛先は必須です').max(200).optional(),
    lifecycle_status: lifecycleStatusSchema.optional(),
    scope: z.string().trim().min(1).max(2000).optional(),
    rationale: z.string().trim().min(1).max(2000).optional(),
    deadline: z.string().datetime().optional(),
    progress_done: z.number().int().min(0).optional(),
    progress_total: z.number().int().min(1).optional(),
    // --- 相談(薬剤師に相談 / 事務へ戻す p0_27)起票用 ---
    consult_status: consultStatusSchema.optional(),
  })
  .superRefine((value, refinementCtx) => {
    const hasRecipient = Boolean(value.recipient_label || value.recipient_user_id);
    // フリー連絡(伝言): 宛先 + 内容のみ。3点セット・相談状態は不要。
    if (value.kind === 'message') {
      if (!hasRecipient) {
        refinementCtx.addIssue({
          code: 'custom',
          path: ['recipient_label'],
          message: '連絡の宛先を指定してください',
        });
      }
      return;
    }
    const isTransfer = hasRecipient;
    const isConsult = Boolean(value.consult_status);
    if (!isTransfer && !isConsult) {
      refinementCtx.addIssue({
        code: 'custom',
        path: ['recipient_label'],
        message: '宛先付きの責任移転または薬剤師相談として作成してください',
      });
      return;
    }
    if (isConsult && !isTransfer) {
      refinementCtx.addIssue({
        code: 'custom',
        path: ['recipient_label'],
        message: '薬剤師相談の宛先が指定されていません',
      });
      return;
    }
    if (isConsult) return;
    // ハンドオフの3点セット: 3つ揃わないと送信できません(12_handoff ルール帯)
    if (!value.scope) {
      refinementCtx.addIssue({
        code: 'custom',
        path: ['scope'],
        message: '①何を(作業の範囲)が揃っていません',
      });
    }
    if (!value.rationale) {
      refinementCtx.addIssue({
        code: 'custom',
        path: ['rationale'],
        message: '②なぜ(根拠)が揃っていません',
      });
    }
    if (!value.deadline) {
      refinementCtx.addIssue({
        code: 'custom',
        path: ['deadline'],
        message: '③いつまで(期限)が揃っていません',
      });
    }
  });

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createHandoffItemSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const board = await prisma.handoffBoard.findFirst({
      where: { id: parsed.data.board_id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!board) return notFound('申し送りボードが見つかりません');

    if (parsed.data.recipient_user_id) {
      const recipient = await prisma.user.findFirst({
        where: { id: parsed.data.recipient_user_id, org_id: ctx.orgId, is_active: true },
        select: { id: true },
      });
      if (!recipient) return validationError('宛先ユーザーが見つかりません');
    }

    const isMessage = parsed.data.kind === 'message';
    const isConsult = !isMessage && Boolean(parsed.data.consult_status);
    const isTransfer =
      !isMessage &&
      !parsed.data.consult_status &&
      Boolean(parsed.data.recipient_label || parsed.data.recipient_user_id);

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      const item = await tx.handoffItem.create({
        data: {
          board_id: parsed.data.board_id,
          content: parsed.data.content,
          priority: parsed.data.priority,
          entity_type: parsed.data.entity_type ?? null,
          entity_id: parsed.data.entity_id ?? null,
          recipient_user_id: parsed.data.recipient_user_id ?? null,
          recipient_label: parsed.data.recipient_label ?? null,
          // 伝言(message)・相談(consult)は lifecycle を持たない。責任移転のみ proposed 既定。
          lifecycle_status:
            isMessage || parsed.data.consult_status
              ? null
              : (parsed.data.lifecycle_status ?? 'proposed'),
          scope: isMessage ? null : (parsed.data.scope ?? null),
          rationale: isMessage ? null : (parsed.data.rationale ?? null),
          deadline: !isMessage && parsed.data.deadline ? new Date(parsed.data.deadline) : null,
          progress_done: isMessage ? null : (parsed.data.progress_done ?? null),
          progress_total: isMessage ? null : (parsed.data.progress_total ?? null),
          consult_status: isMessage ? null : (parsed.data.consult_status ?? null),
          read_by: [],
          created_by: ctx.userId,
        },
      });

      if (isTransfer) {
        // 責任の移転は「受領確認と根拠が必ず記録されます」(12_handoff)。
        await createAuditLogEntry(tx, ctx, {
          action: 'handoff_transfer_created',
          targetType: 'handoff_item',
          targetId: item.id,
          changes: {
            recipient_user_id: item.recipient_user_id,
            recipient_label: item.recipient_label,
            scope: item.scope,
            rationale: item.rationale,
            deadline: item.deadline?.toISOString() ?? null,
          },
        });
      } else if (isMessage) {
        // 薬局内フリー連絡も監査既定方針に沿って軽量に記録する。
        await createAuditLogEntry(tx, ctx, {
          action: 'handoff_message_created',
          targetType: 'handoff_item',
          targetId: item.id,
          changes: {
            recipient_user_id: item.recipient_user_id,
            recipient_label: item.recipient_label,
          },
        });
      } else if (isConsult) {
        // 相談の起票(誰が誰に相談したか)も監査既定方針に沿って記録する。
        // 対応(resolve)側は handoff_consult_resolved を記録しており、起票/対応で対称にする。
        await createAuditLogEntry(tx, ctx, {
          action: 'handoff_consult_created',
          targetType: 'handoff_item',
          targetId: item.id,
          changes: {
            recipient_user_id: item.recipient_user_id,
            recipient_label: item.recipient_label,
            consult_status: item.consult_status,
          },
        });
      }

      return item;
    });

    return success({ data: created }, 201);
  },
  {
    permission: 'canReport',
    message: '申し送り項目の追加権限がありません',
  },
);
