import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { broadcastOrgRealtimeEvent } from '@/server/services/org-realtime';
import {
  canAccessCollaborationEntity,
  collaborationEntityRefSchema,
  collaborationEntityTypeSchema,
} from '@/server/services/collaboration-access';
import { z } from 'zod';

const createCommentSchema = z.object({
  // 担当外の臨床エンティティ(care_report/visit_record 等)への越境コメントを防ぐため、
  // entity_type は collaboration の許可 enum に限定し、後段で per-entity 認可を行う。
  entity_type: collaborationEntityTypeSchema,
  entity_id: z.string().trim().min(1, 'entity_idは必須です').max(100),
  content: z.string().trim().min(1, 'コメント内容は必須です').max(4000),
  mentions: z.array(z.string()).default([]),
});

const ENTITY_TYPE_LINK_PREFIX: Record<string, string> = {
  dispense_task: '/dispense',
  medication_cycle: '/patients',
  set_plan: '/set',
  visit_record: '/visits',
  care_report: '/reports',
};

const COMMENT_THREAD_LIMIT = 100;

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsedRef = collaborationEntityRefSchema.safeParse({
      entity_type: searchParams.get('entity_type'),
      entity_id: searchParams.get('entity_id'),
    });
    if (!parsedRef.success) {
      return validationError('entity_typeとentity_idは必須です');
    }
    const { entity_type: entityType, entity_id: entityId } = parsedRef.data;

    // 担当外エンティティのコメント(PHIを含み得る)閲覧を防ぐ per-entity 認可。
    const canAccess = await canAccessCollaborationEntity(ctx, entityType, entityId);
    if (!canAccess) return notFound('コメント対象が見つかりません');

    const comments = await prisma.taskComment.findMany({
      where: {
        org_id: ctx.orgId,
        entity_type: entityType,
        entity_id: entityId,
      },
      orderBy: { created_at: 'desc' },
      take: COMMENT_THREAD_LIMIT,
    });
    const commentsAscending = [...comments].reverse();

    const authorIds = [...new Set(commentsAscending.map((c) => c.author_id))];
    const authors =
      authorIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: authorIds }, org_id: ctx.orgId },
            select: { id: true, name: true },
          });
    const authorMap = new Map(authors.map((a) => [a.id, a.name]));

    const data = commentsAscending.map((c) => ({
      ...c,
      author_name: authorMap.get(c.author_id) ?? '不明',
    }));

    return success({ data });
  },
  {
    // コメント閲覧はカード参加（多職種連携）であり、特権的な操作ではない。
    // 事務（clerk）も参加者として表示・参加するため、組織メンバーレベルの canViewDashboard でゲートする。
    permission: 'canViewDashboard',
    message: 'コメントの閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCommentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    // 担当外エンティティへの越境コメント投稿を防ぐ per-entity 認可。
    const canAccess = await canAccessCollaborationEntity(
      ctx,
      parsed.data.entity_type,
      parsed.data.entity_id,
    );
    if (!canAccess) return notFound('コメント対象が見つかりません');

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
        const linkPrefix = ENTITY_TYPE_LINK_PREFIX[parsed.data.entity_type] ?? '';
        const link = linkPrefix ? `${linkPrefix}/${parsed.data.entity_id}` : null;

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

    await broadcastOrgRealtimeEvent({
      orgId: ctx.orgId,
      type: 'comment_refresh',
    });

    return success({ data: created }, 201);
  },
  {
    // コメント投稿も多職種連携の参加であり、組織メンバーレベルの canViewDashboard でゲートする。
    permission: 'canViewDashboard',
    message: 'コメントの投稿権限がありません',
  },
);
