import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { buildDispenseTaskHref } from '@/lib/dispense/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import type { MemberRole, Prisma } from '@prisma/client';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { broadcastOrgRealtimeEvent } from '@/server/services/org-realtime';
import {
  canAccessCollaborationEntity,
  type CollaborationEntityType,
  collaborationEntityRefSchema,
  collaborationEntityTypeSchema,
} from '@/server/services/collaboration-access';
import { z } from 'zod';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

const COMMENT_THREAD_LIMIT = 100;
const COMMENT_MENTION_LIMIT = 20;
const COMMENT_MENTION_ID_LIMIT = 100;
const COMMENT_MENTION_RECIPIENT_ROLES = [
  'owner',
  'admin',
  'pharmacist',
  'pharmacist_trainee',
] as const satisfies readonly MemberRole[];

const createCommentSchema = z.object({
  // 担当外の臨床エンティティ(care_report/visit_record 等)への越境コメントを防ぐため、
  // entity_type は collaboration の許可 enum に限定し、後段で per-entity 認可を行う。
  entity_type: collaborationEntityTypeSchema,
  entity_id: z.string().trim().min(1, 'entity_idは必須です').max(100),
  content: z.string().trim().min(1, 'コメント内容は必須です').max(4000),
  mentions: z
    .array(z.string().trim().min(1, 'メンション先が不正です').max(COMMENT_MENTION_ID_LIMIT))
    .max(COMMENT_MENTION_LIMIT, `メンション先は${COMMENT_MENTION_LIMIT}件までです`)
    .default([]),
});

type CommentMentionLinkTx = Pick<Prisma.TransactionClient, 'medicationCycle'>;

function normalizeCommentMentions(mentions: string[]) {
  return Array.from(new Set(mentions));
}

async function areCommentMentionRecipientsValid(orgId: string, mentions: string[]) {
  if (mentions.length === 0) return true;

  const memberships = await prisma.membership.findMany({
    where: {
      org_id: orgId,
      is_active: true,
      role: { in: [...COMMENT_MENTION_RECIPIENT_ROLES] },
      user_id: { in: mentions },
    },
    select: { user_id: true },
  });
  const validUserIds = new Set(memberships.map((membership) => membership.user_id));
  return mentions.every((mention) => validUserIds.has(mention));
}

async function buildCommentMentionLink(
  tx: CommentMentionLinkTx,
  args: { orgId: string; entityType: CollaborationEntityType; entityId: string },
) {
  if (args.entityType === 'medication_cycle') {
    const cycle = await tx.medicationCycle.findFirst({
      where: { id: args.entityId, org_id: args.orgId },
      select: { patient_id: true },
    });
    return cycle ? buildPatientHref(cycle.patient_id) : null;
  }

  const entityId = encodeURIComponent(args.entityId);
  switch (args.entityType) {
    case 'patient':
      return buildPatientHref(args.entityId);
    case 'dispense_task':
      return buildDispenseTaskHref(args.entityId);
    case 'set_plan':
      return `/set?planId=${entityId}`;
    case 'visit_record':
      return `/visits/${entityId}`;
    case 'care_report':
      return `/reports/${entityId}`;
    default:
      return null;
  }
}

const authenticatedGET = withAuthContext(
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

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCommentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }
    const mentions = normalizeCommentMentions(parsed.data.mentions);

    // 担当外エンティティへの越境コメント投稿を防ぐ per-entity 認可。
    const canAccess = await canAccessCollaborationEntity(
      ctx,
      parsed.data.entity_type,
      parsed.data.entity_id,
    );
    if (!canAccess) return notFound('コメント対象が見つかりません');

    const canMentionRecipients = await areCommentMentionRecipientsValid(ctx.orgId, mentions);
    if (!canMentionRecipients) return validationError('メンション先が不正です');

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      const comment = await tx.taskComment.create({
        data: {
          org_id: ctx.orgId,
          entity_type: parsed.data.entity_type,
          entity_id: parsed.data.entity_id,
          author_id: ctx.userId,
          content: parsed.data.content,
          mentions,
        },
      });

      if (mentions.length > 0) {
        const author = await tx.user.findFirst({
          where: { id: ctx.userId, org_id: ctx.orgId },
          select: { name: true },
        });
        const authorName = author?.name ?? '不明';
        const link = await buildCommentMentionLink(tx, {
          orgId: ctx.orgId,
          entityType: parsed.data.entity_type,
          entityId: parsed.data.entity_id,
        });

        await dispatchNotificationEvent(tx, {
          orgId: ctx.orgId,
          eventType: 'comment_mention',
          type: 'business',
          title: `${authorName}があなたをメンションしました`,
          message: parsed.data.content.slice(0, 100),
          link,
          explicitUserIds: mentions,
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
