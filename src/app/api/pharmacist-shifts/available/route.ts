import type { Prisma } from '@prisma/client';

import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  availablePharmacistShiftQuerySchema,
  toShiftTimeValue,
} from '@/lib/validations/pharmacist-shift';

const ROUTE = '/api/pharmacist-shifts/available';
const DEFAULT_AVAILABLE_SHIFT_LIMIT = 500;
const MAX_AVAILABLE_SHIFT_LIMIT = 500;

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'シフト空き状況の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');

    if (!date) return validationError('dateパラメータは必須です');

    const parsed = availablePharmacistShiftQuerySchema.safeParse({
      date,
      ...(searchParams.has('time_from') ? { time_from: searchParams.get('time_from') } : {}),
      ...(searchParams.has('time_to') ? { time_to: searchParams.get('time_to') } : {}),
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }

    const { date: dateKey, time_from: timeFrom, time_to: timeTo } = parsed.data;
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_AVAILABLE_SHIFT_LIMIT,
      1,
      MAX_AVAILABLE_SHIFT_LIMIT,
    );
    const targetDate = new Date(dateKey);
    const timeWindowFilters: Prisma.PharmacistShiftWhereInput[] = [];

    if (timeFrom) {
      const requestedFrom = toShiftTimeValue(timeFrom);
      if (requestedFrom) {
        timeWindowFilters.push({
          OR: [{ available_from: null }, { available_from: { lte: requestedFrom } }],
        });
      }
    }

    if (timeTo) {
      const requestedTo = toShiftTimeValue(timeTo);
      if (requestedTo) {
        timeWindowFilters.push({
          OR: [{ available_to: null }, { available_to: { gte: requestedTo } }],
        });
      }
    }

    const availability = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const holidays = await tx.businessHoliday.findMany({
          where: {
            org_id: ctx.orgId,
            date: targetDate,
            is_closed: true,
          },
          select: {
            site_id: true,
          },
        });

        const hasOrgWideClosure = holidays.some((holiday) => holiday.site_id == null);
        if (hasOrgWideClosure) {
          return {
            hasOrgWideClosure,
            shifts: [],
          };
        }

        const blockedSiteIds = [
          ...new Set(
            holidays
              .map((holiday) => holiday.site_id)
              .filter((siteId): siteId is string => siteId != null),
          ),
        ];

        const shifts = await tx.pharmacistShift.findMany({
          where: {
            org_id: ctx.orgId,
            date: targetDate,
            available: true,
            ...(blockedSiteIds.length > 0 ? { site_id: { notIn: blockedSiteIds } } : {}),
            ...(timeWindowFilters.length > 0 ? { AND: timeWindowFilters } : {}),
          },
          include: {
            user: { select: { id: true, name: true, name_kana: true } },
          },
          orderBy: { user: { name_kana: 'asc' } },
          take: limit + 1,
        });

        return {
          hasOrgWideClosure,
          shifts,
        };
      },
      { requestContext: ctx },
    );

    const { hasOrgWideClosure, shifts } = availability;
    if (hasOrgWideClosure) {
      return success({ data: [], meta: { limit, has_more: false } });
    }

    const hasMore = shifts.length > limit;
    const availableShifts = shifts.slice(0, limit);

    return success({ data: availableShifts, meta: { limit, has_more: hasMore } });
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
          event: 'pharmacist_shifts_available_get_unhandled_error',
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
