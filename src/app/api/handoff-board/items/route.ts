import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createHandoffItemSchema = z.object({
  board_id: z.string().trim().min(1, 'board_idは必須です'),
  content: z.string().trim().min(1, '内容は必須です').max(4000),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  entity_type: z.string().trim().max(100).optional(),
  entity_id: z.string().trim().max(100).optional(),
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

    const created = await withOrgContext(ctx.orgId, (tx) =>
      tx.handoffItem.create({
        data: {
          board_id: parsed.data.board_id,
          content: parsed.data.content,
          priority: parsed.data.priority,
          entity_type: parsed.data.entity_type ?? null,
          entity_id: parsed.data.entity_id ?? null,
          read_by: [],
          created_by: ctx.userId,
        },
      }),
    );

    return success({ data: created }, 201);
  },
  {
    permission: 'canDispense',
    message: '申し送り項目の追加権限がありません',
  },
);
