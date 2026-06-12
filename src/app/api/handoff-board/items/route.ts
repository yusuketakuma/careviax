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
 * 揃わないと送信できない。宛先なしの legacy 申し送り(content + priority のみ)は
 * 従来どおり受け付ける(後方互換)。
 */

const lifecycleStatusSchema = z.enum(['proposed', 'in_progress', 'confirming', 'completed']);

const createHandoffItemSchema = z
  .object({
    board_id: z.string().trim().min(1, 'board_idは必須です'),
    content: z.string().trim().min(1, '内容は必須です').max(4000),
    priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
    entity_type: z.string().trim().max(100).optional(),
    entity_id: z.string().trim().max(100).optional(),
    // --- 責任移転(仕事を渡す)用の拡張フィールド ---
    recipient_user_id: z.string().trim().min(1).max(100).optional(),
    recipient_label: z.string().trim().min(1, '宛先は必須です').max(200).optional(),
    lifecycle_status: lifecycleStatusSchema.optional(),
    scope: z.string().trim().min(1).max(2000).optional(),
    rationale: z.string().trim().min(1).max(2000).optional(),
    deadline: z.string().datetime().optional(),
    progress_done: z.number().int().min(0).optional(),
    progress_total: z.number().int().min(1).optional(),
  })
  .superRefine((value, refinementCtx) => {
    const isTransfer = Boolean(value.recipient_label || value.recipient_user_id);
    if (!isTransfer) return;
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
        where: { id: parsed.data.recipient_user_id, org_id: ctx.orgId },
        select: { id: true },
      });
      if (!recipient) return validationError('宛先ユーザーが見つかりません');
    }

    const isTransfer = Boolean(parsed.data.recipient_label || parsed.data.recipient_user_id);

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
          lifecycle_status: isTransfer
            ? (parsed.data.lifecycle_status ?? 'proposed')
            : (parsed.data.lifecycle_status ?? null),
          scope: parsed.data.scope ?? null,
          rationale: parsed.data.rationale ?? null,
          deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
          progress_done: parsed.data.progress_done ?? null,
          progress_total: parsed.data.progress_total ?? null,
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
      }

      return item;
    });

    return success({ data: created }, 201);
  },
  {
    permission: 'canDispense',
    message: '申し送り項目の追加権限がありません',
  },
);
