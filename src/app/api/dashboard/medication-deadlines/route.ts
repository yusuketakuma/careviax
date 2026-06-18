import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import {
  boundedIntegerSearchParam,
  optionalBlankableBoundedIntegerSearchParam,
  parseSearchParams,
} from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

const DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS = 7;
const MAX_MEDICATION_DEADLINE_WITHIN_DAYS = 365;

const medicationDeadlineQuerySchema = z.object({
  within_days: boundedIntegerSearchParam(
    'within_days',
    0,
    MAX_MEDICATION_DEADLINE_WITHIN_DAYS,
    DEFAULT_MEDICATION_DEADLINE_WITHIN_DAYS,
  ),
  limit: optionalBlankableBoundedIntegerSearchParam('limit', 1, 50),
  q: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().max(100).optional(),
  ),
});

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(medicationDeadlineQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }
    const withinDays = parsed.data.within_days;
    const query = parsed.data.q || null;

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
      take: parsed.data.limit,
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
