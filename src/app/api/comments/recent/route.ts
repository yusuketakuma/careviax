import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';

/**
 * 薬局内のやり取り(TaskComment)を handoff ハブへ集約するための横断フィード。
 *
 * 散在するエンティティ別コメントスレッドを「自分が関与したもの」に限って 1 箇所に集める。
 * per-entity 認可を回避できるよう、対象は「自分が書いた」または「自分が @ された」コメントに
 * 限定する(いずれも自分が当事者であり PHI 越境にならない)。直近 7 日・上限 20 件。
 */

const RECENT_COMMENT_LIMIT = 20;
const RECENT_COMMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const authenticatedGET = withAuthContext(
  async (_req, ctx) => {
    const since = new Date(Date.now() - RECENT_COMMENT_WINDOW_MS);

    const comments = await prisma.taskComment.findMany({
      where: {
        org_id: ctx.orgId,
        created_at: { gte: since },
        OR: [{ author_id: ctx.userId }, { mentions: { has: ctx.userId } }],
      },
      orderBy: { created_at: 'desc' },
      take: RECENT_COMMENT_LIMIT,
    });

    const authorIds = [...new Set(comments.map((comment) => comment.author_id))];
    const authors =
      authorIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: authorIds }, org_id: ctx.orgId },
            select: { id: true, name: true },
          });
    const authorMap = new Map(authors.map((author) => [author.id, author.name]));

    const data = comments.map((comment) => ({
      id: comment.id,
      entity_type: comment.entity_type,
      entity_id: comment.entity_id,
      content: comment.content,
      author_id: comment.author_id,
      author_name: authorMap.get(comment.author_id) ?? '不明',
      mentions_me: comment.mentions.includes(ctx.userId),
      authored_by_me: comment.author_id === ctx.userId,
      created_at: comment.created_at,
    }));

    return success({ data });
  },
  {
    // コメント参加は組織メンバーレベル(事務も含む)。/api/comments の GET と同じゲート。
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
