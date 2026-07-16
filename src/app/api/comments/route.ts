import type { MemberRole, Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { buildDispenseTaskHref } from '@/lib/dispense/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildSetPlanHref } from '@/lib/set/navigation';
import { logger } from '@/lib/utils/logger';
import { buildVisitHref } from '@/lib/visits/navigation';
import {
  canAccessCollaborationEntity,
  type CollaborationEntityType,
  collaborationEntityRefSchema,
  collaborationEntityTypeSchema,
} from '@/server/services/collaboration-access';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { broadcastOrgRealtimeEvent } from '@/server/services/org-realtime';

const COMMENT_THREAD_LIMIT = 100;
const COMMENT_MENTION_LIMIT = 20;
const COMMENT_MENTION_ID_LIMIT = 100;
const COMMENT_MENTION_RECIPIENT_ROLES = [
  'owner',
  'admin',
  'pharmacist',
  'pharmacist_trainee',
] as const satisfies readonly MemberRole[];

const commentMentionSchema = z
  .array(z.string().trim().min(1, 'メンション先が不正です').max(COMMENT_MENTION_ID_LIMIT))
  .max(COMMENT_MENTION_LIMIT, `メンション先は${COMMENT_MENTION_LIMIT}件までです`)
  .superRefine((mentions, context) => {
    if (new Set(mentions).size !== mentions.length) {
      context.addIssue({
        code: 'custom',
        message: 'メンション先に重複があります',
      });
    }
  });

const createCommentSchema = z.object({
  entity_type: collaborationEntityTypeSchema,
  entity_id: z.string().trim().min(1, 'entity_idは必須です').max(100),
  content: z.string().trim().min(1, 'コメント内容は必須です').max(4000),
  mentions: commentMentionSchema.default([]),
});

const commentListSelect = {
  id: true,
  author_id: true,
  content: true,
  mentions: true,
  created_at: true,
} as const;

const createdCommentSelect = {
  id: true,
  entity_type: true,
  entity_id: true,
  content: true,
  mentions: true,
  created_at: true,
} as const;

type CommentTx = Pick<
  Prisma.TransactionClient,
  'membership' | 'taskComment' | 'user' | 'medicationCycle'
>;

async function areCommentMentionRecipientsValid(tx: CommentTx, orgId: string, mentions: string[]) {
  if (mentions.length === 0) return true;

  const memberships = await tx.membership.findMany({
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
  tx: CommentTx,
  args: { orgId: string; entityType: CollaborationEntityType; entityId: string },
) {
  if (args.entityType === 'medication_cycle') {
    const cycle = await tx.medicationCycle.findFirst({
      where: { id: args.entityId, org_id: args.orgId },
      select: { patient_id: true },
    });
    return cycle ? buildPatientHref(cycle.patient_id) : null;
  }

  switch (args.entityType) {
    case 'patient':
      return buildPatientHref(args.entityId);
    case 'dispense_task':
      return buildDispenseTaskHref(args.entityId);
    case 'set_plan':
      return buildSetPlanHref(args.entityId);
    case 'visit_record':
      return buildVisitHref(args.entityId);
    case 'care_report':
      return buildReportHref(args.entityId);
    default:
      return null;
  }
}

function parseCommentEntityRef(searchParams: URLSearchParams) {
  const entityTypeValues = searchParams.getAll('entity_type');
  const entityIdValues = searchParams.getAll('entity_id');
  if (entityTypeValues.length !== 1 || entityIdValues.length !== 1) return null;

  return collaborationEntityRefSchema.safeParse({
    entity_type: entityTypeValues[0],
    entity_id: entityIdValues[0],
  });
}

async function commentsGET(req: NextRequest, ctx: AuthContext) {
  const parsedRef = parseCommentEntityRef(req.nextUrl.searchParams);
  if (!parsedRef || !parsedRef.success) {
    return withSensitiveNoStore(validationError('entity_typeとentity_idは必須です'));
  }
  const { entity_type: entityType, entity_id: entityId } = parsedRef.data;

  const canAccess = await canAccessCollaborationEntity(ctx, entityType, entityId);
  if (!canAccess) return withSensitiveNoStore(notFound('コメント対象が見つかりません'));

  const data = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const comments = await tx.taskComment.findMany({
        where: {
          org_id: ctx.orgId,
          entity_type: entityType,
          entity_id: entityId,
        },
        select: commentListSelect,
        orderBy: { created_at: 'desc' },
        take: COMMENT_THREAD_LIMIT,
      });
      const commentsAscending = [...comments].reverse();
      const authorIds = [...new Set(commentsAscending.map((comment) => comment.author_id))];
      const authors =
        authorIds.length === 0
          ? []
          : await tx.user.findMany({
              where: { id: { in: authorIds }, org_id: ctx.orgId },
              select: { id: true, name: true },
            });
      const authorMap = new Map(authors.map((author) => [author.id, author.name]));

      return commentsAscending.map((comment) => ({
        ...comment,
        author_name: authorMap.get(comment.author_id) ?? '不明',
      }));
    },
    { requestContext: ctx },
  );

  return withSensitiveNoStore(success({ data }));
}

export const GET = withAuthContext(commentsGET, {
  permission: 'canViewDashboard',
  message: 'コメントの閲覧権限がありません',
});

async function commentsPOST(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = createCommentSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const canAccess = await canAccessCollaborationEntity(
    ctx,
    parsed.data.entity_type,
    parsed.data.entity_id,
  );
  if (!canAccess) return withSensitiveNoStore(notFound('コメント対象が見つかりません'));

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const recipientsValid = await areCommentMentionRecipientsValid(
        tx,
        ctx.orgId,
        parsed.data.mentions,
      );
      if (!recipientsValid) return { kind: 'invalid_mentions' as const };

      const comment = await tx.taskComment.create({
        data: {
          org_id: ctx.orgId,
          entity_type: parsed.data.entity_type,
          entity_id: parsed.data.entity_id,
          author_id: ctx.userId,
          content: parsed.data.content,
          mentions: parsed.data.mentions,
        },
        select: createdCommentSelect,
      });

      if (parsed.data.mentions.length > 0) {
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
          explicitUserIds: parsed.data.mentions,
        });
      }

      return { kind: 'created' as const, comment };
    },
    { requestContext: ctx },
  );

  if (result.kind === 'invalid_mentions') {
    return withSensitiveNoStore(validationError('メンション先が不正です'));
  }

  await broadcastOrgRealtimeEvent({
    orgId: ctx.orgId,
    type: 'comment_refresh',
  }).catch((cause: unknown) => {
    logger.warn(
      {
        event: 'comments_realtime_broadcast_failed',
        route: '/api/comments',
        method: 'POST',
        operation: 'comment_refresh_broadcast',
        orgId: ctx.orgId,
      },
      cause,
    );
  });

  return withSensitiveNoStore(success({ data: result.comment }, 201));
}

export const POST = withAuthContext(commentsPOST, {
  permission: 'canViewDashboard',
  message: 'コメントの投稿権限がありません',
});
