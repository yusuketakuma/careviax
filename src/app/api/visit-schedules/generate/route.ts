import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { generateVisitSchedulesSchema } from '@/lib/validations/visit-schedule';
import { prisma } from '@/lib/db/client';

/**
 * Parse a simple RRULE string to generate visit dates within a range.
 * MVP: supports FREQ=WEEKLY and FREQ=MONTHLY with BYDAY and INTERVAL.
 * Example: "FREQ=WEEKLY;INTERVAL=1;BYDAY=WE" → every Wednesday
 * Example: "FREQ=MONTHLY;INTERVAL=1;BYDAY=1WE" → 1st Wednesday of each month
 */
function parseRruleDates(rrule: string, startDate: Date, endDate: Date): Date[] {
  const parts = Object.fromEntries(
    rrule.split(';').map((p) => {
      const [key, val] = p.split('=');
      return [key, val];
    })
  );

  const freq = parts['FREQ'];
  const interval = parseInt(parts['INTERVAL'] ?? '1', 10);
  const byday = parts['BYDAY'];

  const dayNameToIndex: Record<string, number> = {
    SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
  };

  const dates: Date[] = [];

  if (freq === 'WEEKLY' && byday) {
    const targetDays = byday.split(',').map((d) => dayNameToIndex[d]).filter((d) => d !== undefined);
    const current = new Date(startDate);
    // Advance to first matching day
    while (current <= endDate) {
      if (targetDays.includes(current.getDay())) {
        dates.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
      // Skip non-interval weeks — simplified: collect all matching days then filter
    }
    // Apply interval: keep every Nth occurrence per weekday
    if (interval > 1) {
      const filtered: Date[] = [];
      const countPerDay: Record<number, number> = {};
      for (const d of dates) {
        const dow = d.getDay();
        countPerDay[dow] = (countPerDay[dow] ?? 0) + 1;
        if ((countPerDay[dow] - 1) % interval === 0) {
          filtered.push(d);
        }
      }
      return filtered;
    }
    return dates;
  }

  if (freq === 'MONTHLY' && byday) {
    // Support "NWD" format e.g. "1WE" = 1st Wednesday, "2MO" = 2nd Monday
    const match = byday.match(/^(-?\d)([A-Z]{2})$/);
    if (!match) return dates;
    const nthOccurrence = parseInt(match[1], 10);
    const targetDayIndex = dayNameToIndex[match[2]];
    if (targetDayIndex === undefined) return dates;

    let monthCursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    let monthCount = 0;
    while (monthCursor <= endMonth) {
      if (monthCount % interval === 0) {
        const date = nthWeekdayOfMonth(monthCursor.getFullYear(), monthCursor.getMonth(), targetDayIndex, nthOccurrence);
        if (date && date >= startDate && date <= endDate) {
          dates.push(date);
        }
      }
      monthCount++;
      monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
    }
    return dates;
  }

  return dates;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date | null {
  if (nth > 0) {
    const first = new Date(year, month, 1);
    const diff = (weekday - first.getDay() + 7) % 7;
    const day = 1 + diff + (nth - 1) * 7;
    if (day > new Date(year, month + 1, 0).getDate()) return null;
    return new Date(year, month, day);
  } else if (nth < 0) {
    // Last occurrence: nth = -1 means last
    const last = new Date(year, month + 1, 0);
    const diff = (last.getDay() - weekday + 7) % 7;
    const day = last.getDate() - diff + (nth + 1) * 7;
    if (day < 1) return null;
    return new Date(year, month, day);
  }
  return null;
}

// Insurance visit frequency limits: medical=4/month, care=2/month
const MONTHLY_LIMITS: Record<string, number> = {
  medical: 4,
  care: 2,
};

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = generateVisitSchedulesSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const {
    case_id,
    visit_type,
    pharmacist_id,
    recurrence_rule,
    start_date,
    end_date,
    time_window_start,
    time_window_end,
  } = parsed.data;

  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  if (startDate > endDate) {
    return validationError('開始日は終了日以前である必要があります');
  }

  const candidateDates = parseRruleDates(recurrence_rule, startDate, endDate);

  if (candidateDates.length === 0) {
    return validationError('指定されたRRULEから日程を生成できませんでした');
  }

  // Check monthly visit count limits
  const insuranceType = body.insurance_type as string | undefined;
  if (insuranceType && MONTHLY_LIMITS[insuranceType] !== undefined) {
    const limit = MONTHLY_LIMITS[insuranceType];
    const monthCounts: Record<string, number> = {};
    for (const d of candidateDates) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthCounts[key] = (monthCounts[key] ?? 0) + 1;
      if (monthCounts[key] > limit) {
        return validationError(
          `月間訪問回数の上限を超えています（${insuranceType === 'medical' ? '医療' : '介護'}保険: 月${limit}回まで）`
        );
      }
    }
  }

  const schedules = await withOrgContext(req.orgId, async (tx) => {
    const careCase = await tx.careCase.findFirst({
      where: {
        id: case_id,
        org_id: req.orgId,
      },
      select: {
        primary_pharmacist_id: true,
      },
    });

    const created = await Promise.all(
      candidateDates.map(async (date) => {
        const shift = await prisma.pharmacistShift.findFirst({
          where: {
            org_id: req.orgId,
            user_id: pharmacist_id,
            date,
          },
          select: {
            site_id: true,
          },
        });

        return tx.visitSchedule.create({
          data: {
            org_id: req.orgId,
            case_id,
            visit_type,
            priority: 'normal',
            pharmacist_id,
            site_id: shift?.site_id ?? null,
            assignment_mode:
              careCase?.primary_pharmacist_id &&
              careCase.primary_pharmacist_id === pharmacist_id
                ? 'primary'
                : 'fallback',
            scheduled_date: date,
            recurrence_rule,
            ...(time_window_start
              ? { time_window_start: new Date(`1970-01-01T${time_window_start}`) }
              : {}),
            ...(time_window_end
              ? { time_window_end: new Date(`1970-01-01T${time_window_end}`) }
              : {}),
            confirmed_at: new Date(),
            confirmed_by: req.userId,
          },
        })
      })
    );
    return created;
  });

  return success({ data: schedules, count: schedules.length }, 201);
}, {
  permission: 'canVisit',
  message: '訪問予定の自動生成権限がありません',
});
