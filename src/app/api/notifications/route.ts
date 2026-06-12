import { isAdmin, withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, forbidden } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';

export const GET = withAuthContext(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const userId = searchParams.get('user_id') ?? ctx.userId;
  if (userId !== ctx.userId && !isAdmin(ctx.role)) {
    return forbidden('他ユーザーの通知閲覧には管理者権限が必要です');
  }

  const isReadParam = searchParams.get('is_read');
  const isRead = isReadParam === 'true' ? true : isReadParam === 'false' ? false : undefined;

  const where = {
    org_id: ctx.orgId,
    user_id: userId,
    ...(isRead !== undefined ? { is_read: isRead } : {}),
  };

  const notifications = await withOrgContext(ctx.orgId, (tx) =>
    tx.notification.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { created_at: 'desc' },
    }),
  );

  const hasMore = notifications.length > limit;
  const data = hasMore ? notifications.slice(0, limit) : notifications;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const PATCH = withAuthContext(async (req, ctx) => {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  if (payload.all === true) {
    // Mark all as read for the current user
    await withOrgContext(ctx.orgId, (tx) =>
      tx.notification.updateMany({
        where: { org_id: ctx.orgId, user_id: ctx.userId, is_read: false },
        data: { is_read: true, read_at: new Date() },
      }),
    );
    return success({ message: '全て既読にしました' });
  }

  if (payload.all !== undefined && payload.all !== false) {
    return validationError('ids または all が必要です');
  }

  const ids = Array.isArray(payload.ids)
    ? Array.from(
        new Set(
          payload.ids.flatMap((id) => {
            if (typeof id !== 'string') return [];
            const trimmed = id.trim();
            return trimmed ? [trimmed] : [];
          }),
        ),
      )
    : null;
  if (!ids || ids.length === 0) {
    return validationError('ids または all が必要です');
  }

  await withOrgContext(ctx.orgId, (tx) =>
    tx.notification.updateMany({
      where: {
        id: { in: ids },
        org_id: ctx.orgId,
        user_id: ctx.userId,
      },
      data: { is_read: true, read_at: new Date() },
    }),
  );

  return success({ message: `${ids.length}件を既読にしました` });
});
