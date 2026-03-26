import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { getMembership, isAdmin } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, forbidden } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const userId = searchParams.get('user_id') ?? req.userId;
  if (userId !== req.userId) {
    const membership = await getMembership(req.userId, req.orgId);
    if (!membership || !isAdmin(membership.role)) {
      return forbidden('他ユーザーの通知閲覧には管理者権限が必要です');
    }
  }

  const isReadParam = searchParams.get('is_read');
  const isRead = isReadParam === 'true' ? true : isReadParam === 'false' ? false : undefined;

  const where = {
    org_id: req.orgId,
    user_id: userId,
    ...(isRead !== undefined ? { is_read: isRead } : {}),
  };

  const notifications = await withOrgContext(req.orgId, (tx) =>
    tx.notification.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { created_at: 'desc' },
    })
  );

  const hasMore = notifications.length > limit;
  const data = hasMore ? notifications.slice(0, limit) : notifications;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const PATCH = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const { ids, all } = body as { ids?: string[]; all?: boolean };

  if (all) {
    // Mark all as read for the current user
    await withOrgContext(req.orgId, (tx) =>
      tx.notification.updateMany({
        where: { org_id: req.orgId, user_id: req.userId, is_read: false },
        data: { is_read: true, read_at: new Date() },
      })
    );
    return success({ message: '全て既読にしました' });
  }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return validationError('ids または all が必要です');
  }

  await withOrgContext(req.orgId, (tx) =>
    tx.notification.updateMany({
      where: {
        id: { in: ids },
        org_id: req.orgId,
        user_id: req.userId,
      },
      data: { is_read: true, read_at: new Date() },
    })
  );

  return success({ message: `${ids.length}件を既読にしました` });
});
