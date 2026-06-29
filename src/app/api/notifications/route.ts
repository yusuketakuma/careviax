import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';

import { isAdmin, requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, forbidden, internalError } from '@/lib/api/response';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/notifications';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const summaryOnly = searchParams.get('summary') === '1';

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

    if (summaryOnly) {
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

      return success({ data: { unreadCount } });
    }

    const notifications = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.notification.findMany({
          where,
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        }),
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    return success(buildCursorPage(notifications, limit, (notification) => notification.id));
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('notifications_get_unhandled_error', undefined, {
        event: 'notifications_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}

async function authenticatedPATCH(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    if (payload.all === true) {
      // Mark all as read for the current user
      await withOrgContext(
        ctx.orgId,
        (tx) =>
          tx.notification.updateMany({
            where: { org_id: ctx.orgId, user_id: ctx.userId, is_read: false },
            data: { is_read: true, read_at: new Date() },
          }),
        { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
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

    return success({ message: `${ids.length}件を既読にしました` });
  });
}

export async function PATCH(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  try {
    return withSensitiveNoStore(await authenticatedPATCH(req));
  } catch (err) {
    unstable_rethrow(err);
    logger.error('notifications_patch_unhandled_error', undefined, {
      event: 'notifications_patch_unhandled_error',
      route: ROUTE,
      method: req.method,
      status: 500,
      error_name: safeErrorName(err),
    });
    return withSensitiveNoStore(internalError());
  }
}
