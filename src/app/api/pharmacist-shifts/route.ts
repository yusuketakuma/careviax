import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  createPharmacistShiftSchema,
  pharmacistShiftQuerySchema,
  toShiftTimeValue,
} from '@/lib/validations/pharmacist-shift';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';

const ROUTE = '/api/pharmacist-shifts';
const DEFAULT_PHARMACIST_SHIFT_LIMIT = 400;
const MAX_PHARMACIST_SHIFT_LIMIT = 500;

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function endOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'シフト情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const userId = searchParams.get('user_id');
    const siteId = searchParams.get('site_id');
    const rawLimit = searchParams.get('limit');
    const limit =
      rawLimit === null
        ? undefined
        : parseBoundedInteger(
            rawLimit,
            DEFAULT_PHARMACIST_SHIFT_LIMIT,
            1,
            MAX_PHARMACIST_SHIFT_LIMIT,
          );

    const parsed = pharmacistShiftQuerySchema.safeParse({
      ...(month !== null ? { month } : {}),
      ...(dateFrom !== null ? { date_from: dateFrom } : {}),
      ...(dateTo !== null ? { date_to: dateTo } : {}),
      ...(userId !== null ? { user_id: userId } : {}),
      ...(siteId !== null ? { site_id: siteId } : {}),
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }

    const monthDate = parsed.data.month ? utcDateFromLocalKey(parsed.data.month) : null;
    const resolvedDateFrom = monthDate
      ? startOfUtcMonth(monthDate)
      : parsed.data.date_from
        ? utcDateFromLocalKey(parsed.data.date_from)
        : null;
    const resolvedDateTo = monthDate
      ? endOfUtcMonth(monthDate)
      : parsed.data.date_to
        ? utcDateFromLocalKey(parsed.data.date_to)
        : null;

    const shifts = await withOrgContext(
      ctx.orgId,
      async (tx) =>
        tx.pharmacistShift.findMany({
          where: {
            org_id: ctx.orgId,
            ...(resolvedDateFrom || resolvedDateTo
              ? {
                  date: {
                    ...(resolvedDateFrom ? { gte: resolvedDateFrom } : {}),
                    ...(resolvedDateTo ? { lte: resolvedDateTo } : {}),
                  },
                }
              : {}),
            ...(parsed.data.user_id ? { user_id: parsed.data.user_id } : {}),
            ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
          },
          orderBy: [{ date: 'asc' }, { available_from: 'asc' }],
          ...(limit === undefined ? {} : { take: limit + 1 }),
          include: {
            user: { select: { id: true, name: true, name_kana: true } },
            site: { select: { id: true, name: true } },
          },
        }),
      { requestContext: ctx },
    );

    const hasMore = limit === undefined ? false : shifts.length > limit;
    const data = limit === undefined ? shifts : shifts.slice(0, limit);

    return success({
      data,
      ...(limit === undefined ? {} : { meta: { limit, has_more: hasMore } }),
    });
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'pharmacist_shifts_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'シフト情報の作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPharmacistShiftSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { date, available_from, available_to, ...rest } = parsed.data;
    const availableFromValue = toShiftTimeValue(available_from);
    const availableToValue = toShiftTimeValue(available_to);

    const refResult = await validateOrgReferences(ctx.orgId, {
      site_id: rest.site_id,
      pharmacist_id: rest.user_id,
    });
    if (!refResult.ok) return refResult.response;

    const shift = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        return tx.pharmacistShift.upsert({
          where: { user_id_date: { user_id: rest.user_id, date: utcDateFromLocalKey(date) } },
          create: {
            org_id: ctx.orgId,
            date: utcDateFromLocalKey(date),
            ...(availableFromValue !== undefined ? { available_from: availableFromValue } : {}),
            ...(availableToValue !== undefined ? { available_to: availableToValue } : {}),
            ...rest,
          },
          update: {
            site_id: rest.site_id,
            ...(availableFromValue !== undefined ? { available_from: availableFromValue } : {}),
            ...(availableToValue !== undefined ? { available_to: availableToValue } : {}),
            available: rest.available,
            note: rest.note,
          },
        });
      },
      { requestContext: ctx },
    );

    return success(shift, 201);
  });
}

export async function POST(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'pharmacist_shifts_post_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
