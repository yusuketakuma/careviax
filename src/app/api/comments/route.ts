import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { z } from 'zod';

const createCommentSchema = z.object({
  entity_type: z.string().trim().min(1, 'entity_typeは必須です').max(100),
  entity_id: z.string().trim().min(1, 'entity_idは必須です').max(100),
  content: z.string().trim().min(1, 'コメント内容は必須です').max(4000),
  mentions: z.array(z.string()).default([]),
});

const ENTITY_TYPE_LINK_PREFIX: Record<string, string> = {
  dispense_task: '/dispensing',
  medication_cycle: '/patients',
  set_plan: '/medication-sets',
  visit_record: '/visits',
  care_report: '/reports',
};

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entity_type');
    const entityId = searchParams.get('entity_id');

    if (!entityType || !entityId) {
      return validationError('entity_typeとentity_idは必須です');
    }

    const comments = await prisma.taskComment.findMany({
      where: {
        org_id: ctx.orgId,
        entity_type: entityType,
        entity_id: entityId,
      },
      orderBy: { created_at: 'asc' },
    });

    const authorIds = [...new Set(comments.map((c) => c.author_id))];
    const authors =
      authorIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: authorIds }, org_id: ctx.orgId },
            select: { id: true, name: true },
          });
    const authorMap = new Map(authors.map((a) => [a.id, a.name]));

    const data = comments.map((c) => ({
      ...c,
      author_name: authorMap.get(c.author_id) ?? '不明',
    }));

    return success({ data });
  },
  {
    permission: 'canDispense',
    message: 'コメントの閲覧権限がありません',
  }
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createCommentSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      const comment = await tx.taskComment.create({
        data: {
          org_id: ctx.orgId,
          entity_type: parsed.data.entity_type,
          entity_id: parsed.data.entity_id,
          author_id: ctx.userId,
          content: parsed.data.content,
          mentions: parsed.data.mentions,
        },
      });

      if (parsed.data.mentions.length > 0) {
        const author = await tx.user.findFirst({
          where: { id: ctx.userId, org_id: ctx.orgId },
          select: { name: true },
        });
        const authorName = author?.name ?? '不明';
        const linkPrefix =
          ENTITY_TYPE_LINK_PREFIX[parsed.data.entity_type] ?? '';
        const link = linkPrefix
          ? `${linkPrefix}/${parsed.data.entity_id}`
          : null;

        await dispatchNotificationEvent(tx, {
          orgId: ctx.orgId,
          eventType: 'comment_mention',
          type: 'business',
          title: `${authorName}があなたをメンションしました`,
          message: parsed.data.content.slice(0, 100),
          link,
          explicitUserIds: parsed.data.mentions,
        });
      }

      return comment;
    });

    return success({ data: created }, 201);
  },
  {
    permission: 'canDispense',
    message: 'コメントの投稿権限がありません',
  }
);
