import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success, validationError } from '@/lib/api/response';
import { parseExactIntegerSearchParam, readSingleSearchParam } from '@/lib/api/search-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { withRoutePerformance } from '@/lib/utils/performance';

const DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS = 7;
const MAX_MEDICATION_DEADLINE_WITHIN_DAYS = 365;
const ROUTE = '/api/dashboard/medication-deadlines';

type MedicationDeadlineQuery = {
  withinDays: number;
  limit?: number;
  query: string | null;
};

type QueryParseResult =
  | { ok: true; data: MedicationDeadlineQuery }
  | { ok: false; response: ReturnType<typeof validationError> };

function parseMedicationDeadlineQuery(params: URLSearchParams): QueryParseResult {
  const fieldErrors: Record<string, string[]> = {};
  const withinDays = parseExactIntegerSearchParam(
    params,
    'within_days',
    0,
    MAX_MEDICATION_DEADLINE_WITHIN_DAYS,
    DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS,
  );
  let withinDaysValue = DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS;
  if (!withinDays.ok) {
    fieldErrors.within_days = [withinDays.message];
  } else {
    withinDaysValue = withinDays.value ?? DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS;
  }

  const limit = parseExactIntegerSearchParam(params, 'limit', 1, 50);
  let limitValue: number | undefined;
  if (!limit.ok) {
    fieldErrors.limit = [limit.message];
  } else {
    limitValue = limit.value;
  }

  const q = readSingleSearchParam(params, 'q');
  let query: string | null = null;
  if (!q.ok) {
    fieldErrors.q = [q.message];
  } else if (q.value !== null) {
    const trimmed = q.value.trim();
    if (!trimmed || trimmed !== q.value) {
      fieldErrors.q = ['q が不正です'];
    } else if (q.value.length > 100) {
      fieldErrors.q = ['q は100文字以内で指定してください'];
    } else {
      query = q.value;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      response: validationError('クエリパラメータが不正です', fieldErrors),
    };
  }

  return {
    ok: true,
    data: {
      withinDays: withinDaysValue,
      limit: limitValue,
      query,
    },
  };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const parsed = parseMedicationDeadlineQuery(searchParams);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { withinDays, query, limit } = parsed.data;

    // medication_end_date(@db.Date)は UTC 深夜で保存されるため UTC 深夜境界で比較する
    const today = utcDateFromLocalKey(localDateKey());
    const deadline = addUtcDays(today, withinDays);

    // Find visit schedules with medication_end_date approaching
    const schedules = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.visitSchedule.findMany({
          where: {
            org_id: ctx.orgId,
            medication_end_date: {
              gte: today,
              lte: deadline,
            },
            schedule_status: { notIn: ['cancelled', 'completed'] },
            case_: {
              is: {
                org_id: ctx.orgId,
                patient: {
                  is: {
                    org_id: ctx.orgId,
                    ...(query
                      ? {
                          name: {
                            contains: query,
                            mode: 'insensitive',
                          },
                        }
                      : {}),
                  },
                },
              },
            },
          },
          orderBy: { medication_end_date: 'asc' },
          take: limit,
          select: {
            id: true,
            case_id: true,
            scheduled_date: true,
            medication_end_date: true,
            visit_type: true,
            pharmacist_id: true,
            case_: {
              select: {
                patient: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
      { requestContext: ctx },
    );

    // Group by urgency (3 days / 7 days)
    const threeDays = addUtcDays(today, 3);

    const critical = schedules.filter(
      (s) => s.medication_end_date && s.medication_end_date <= threeDays,
    );
    const warning = schedules.filter(
      (s) => s.medication_end_date && s.medication_end_date > threeDays,
    );

    return success({
      data: {
        total: schedules.length,
        critical: { count: critical.length, items: critical },
        warning: { count: warning.length, items: warning },
      },
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
          event: 'dashboard_medication_deadlines_unhandled_error',
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
