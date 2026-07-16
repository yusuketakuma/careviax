import { NextRequest } from 'next/server';
import { buildCursorPage } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  forbidden,
  success,
  successWithMeasuredJsonPayload,
  validationError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { isAdmin, withAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import {
  notificationPublicSelect,
  notificationReadMutationSchema,
  notificationsQuerySchema,
} from '@/lib/notifications/server-contract';

const NOTIFICATION_QUERY_KEYS = ['cursor', 'limit', 'summary', 'user_id', 'is_read'] as const;

function parseSingleQueryValue(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  return values.length <= 1 ? (values[0] ?? null) : undefined;
}

function parseNotificationQuery(searchParams: URLSearchParams) {
  const raw = Object.fromEntries(
    NOTIFICATION_QUERY_KEYS.map((key) => [key, parseSingleQueryValue(searchParams, key)]),
  );
  if (Object.values(raw).some((value) => value === undefined)) return null;

  return notificationsQuerySchema.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null)),
  );
}

async function notificationsGET(req: NextRequest, ctx: AuthContext) {
  const parsedQuery = parseNotificationQuery(req.nextUrl.searchParams);
  if (!parsedQuery || !parsedQuery.success) {
    return withSensitiveNoStore(
      validationError('クエリパラメータが不正です', parsedQuery?.error.flatten().fieldErrors),
    );
  }

  const { cursor, limit, summary, user_id: requestedUserId, is_read: isRead } = parsedQuery.data;
  const userId = requestedUserId ?? ctx.userId;
  if (userId !== ctx.userId && !isAdmin(ctx.role)) {
    return withSensitiveNoStore(forbidden('他ユーザーの通知閲覧には管理者権限が必要です'));
  }

  const where = {
    org_id: ctx.orgId,
    user_id: userId,
    ...(isRead !== undefined ? { is_read: isRead } : {}),
  };

  if (summary === '1') {
    const unreadCount = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.notification.count({
          where: {
            ...where,
            is_read: false,
          },
        }),
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    return withSensitiveNoStore(successWithMeasuredJsonPayload({ data: { unreadCount } }));
  }

  const notifications = await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.notification.findMany({
        where,
        select: notificationPublicSelect,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
    { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
  );

  const page = buildCursorPage(notifications, limit, (notification) => notification.id);
  return withSensitiveNoStore(
    successWithMeasuredJsonPayload({
      data: page.data,
      meta: {
        limit,
        has_more: page.hasMore,
        next_cursor: page.nextCursor ?? null,
      },
    }),
  );
}

export const GET = withAuthContext(notificationsGET);

async function notificationsPATCH(req: NextRequest, ctx: AuthContext) {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = notificationReadMutationSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('ids または all が必要です', parsed.error.flatten().fieldErrors),
    );
  }

  if (parsed.data.all === true) {
    await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.notification.updateMany({
          where: { org_id: ctx.orgId, user_id: ctx.userId, is_read: false },
          data: { is_read: true, read_at: new Date() },
        }),
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );
    return withSensitiveNoStore(success({ data: { message: '全て既読にしました' } }));
  }

  const ids = parsed.data.ids;
  await withOrgContext(
    ctx.orgId,
    (tx) =>
      tx.notification.updateMany({
        where: {
          id: { in: ids },
          org_id: ctx.orgId,
          user_id: ctx.userId,
        },
        data: { is_read: true, read_at: new Date() },
      }),
    { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
  );

  return withSensitiveNoStore(success({ data: { message: `${ids.length}件を既読にしました` } }));
}

export const PATCH = withAuthContext(notificationsPATCH);
