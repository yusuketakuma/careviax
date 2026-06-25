import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

const DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS = 7;
const MAX_MEDICATION_DEADLINE_WITHIN_DAYS = 365;

type MedicationDeadlineQuery = {
  withinDays: number;
  limit?: number;
  query: string | null;
};

type QueryParseResult =
  | { ok: true; data: MedicationDeadlineQuery }
  | { ok: false; response: ReturnType<typeof validationError> };

function parseSingleSearchParam(params: URLSearchParams, field: string) {
  const values = params.getAll(field);
  if (values.length === 0) return { ok: true as const, value: null };
  if (values.length > 1) {
    return {
      ok: false as const,
      message: `${field} は1つだけ指定してください`,
    };
  }
  return { ok: true as const, value: values[0] ?? '' };
}

function parseExactIntegerParam(
  params: URLSearchParams,
  field: string,
  min: number,
  max: number,
  defaultValue?: number,
) {
  const parsed = parseSingleSearchParam(params, field);
  if (!parsed.ok) return parsed;
  if (parsed.value === null) return { ok: true as const, value: defaultValue };
  if (!/^-?\d+$/.test(parsed.value)) {
    return {
      ok: false as const,
      message: `${field} は整数で指定してください`,
    };
  }
  const value = Number(parsed.value);
  if (value < min || value > max) {
    return {
      ok: false as const,
      message: `${field} は${min}以上${max}以下で指定してください`,
    };
  }
  return { ok: true as const, value };
}

function parseMedicationDeadlineQuery(params: URLSearchParams): QueryParseResult {
  const fieldErrors: Record<string, string[]> = {};
  const withinDays = parseExactIntegerParam(
    params,
    'within_days',
    0,
    MAX_MEDICATION_DEADLINE_WITHIN_DAYS,
    DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS,
  );
  if (!withinDays.ok) fieldErrors.within_days = [withinDays.message];

  const limit = parseExactIntegerParam(params, 'limit', 1, 50);
  if (!limit.ok) fieldErrors.limit = [limit.message];

  const q = parseSingleSearchParam(params, 'q');
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
      withinDays: withinDays.value ?? DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS,
      limit: limit.value,
      query,
    },
  };
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
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
    const schedules = await prisma.visitSchedule.findMany({
      where: {
        org_id: ctx.orgId,
        medication_end_date: {
          gte: today,
          lte: deadline,
        },
        schedule_status: { notIn: ['cancelled', 'completed'] },
        ...(query
          ? {
              case_: {
                is: {
                  patient: {
                    is: {
                      name: {
                        contains: query,
                        mode: 'insensitive',
                      },
                    },
                  },
                },
              },
            }
          : {}),
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
    });

    // Group by urgency (3 days / 7 days)
    const threeDays = addUtcDays(today, 3);

    const critical = schedules.filter(
      (s) => s.medication_end_date && s.medication_end_date <= threeDays,
    );
    const warning = schedules.filter(
      (s) => s.medication_end_date && s.medication_end_date > threeDays,
    );

    return success({
      total: schedules.length,
      critical: { count: critical.length, items: critical },
      warning: { count: warning.length, items: warning },
    });
  },
  {
    permission: 'canViewDashboard',
    message: 'ダッシュボードの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) =>
  withSensitiveNoStore(await authenticatedGET(req, routeContext));
