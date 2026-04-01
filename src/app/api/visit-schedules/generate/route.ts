import { format, startOfWeek } from 'date-fns';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { generateVisitSchedulesSchema } from '@/lib/validations/visit-schedule';
import { parseSimpleRruleDates } from '@/lib/visits/rrule';
import { prisma } from '@/lib/db/client';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import type { Prisma } from '@prisma/client';

// Insurance visit frequency limits: medical=4/month, care=2/month
const MONTHLY_LIMITS: Record<string, number> = {
  medical: 4,
  care: 2,
};

const WEEKLY_LIMITS: Record<string, number> = {
  medical: 1,
  care: 1,
};

function normalizeWeekdays(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === 'number');
}

function toTimeString(value: Date | null | undefined) {
  return value ? format(value, 'HH:mm') : undefined;
}

function intersectTimeWindows(
  ...windows: Array<{ from?: string; to?: string } | null | undefined>
) {
  let from: string | undefined;
  let to: string | undefined;

  for (const window of windows) {
    if (!window) continue;
    if (window.from && (!from || window.from > from)) from = window.from;
    if (window.to && (!to || window.to < to)) to = window.to;
  }

  if (from && to && from >= to) return null;
  return { from, to };
}

function buildWeekKey(value: Date) {
  return format(startOfWeek(value, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

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
    insurance_type,
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

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: case_id,
      org_id: req.orgId,
    },
    select: {
      primary_pharmacist_id: true,
      patient: {
        select: {
          scheduling_preference: true,
        },
      },
    },
  });
  if (!careCase) {
    return validationError('対象ケースが見つかりません');
  }

  const candidateDates = parseSimpleRruleDates(recurrence_rule, startDate, endDate);

  if (candidateDates.length === 0) {
    return validationError('指定されたRRULEから日程を生成できませんでした');
  }

  const schedulingPreference = careCase.patient.scheduling_preference;
  const preferredWeekdays = normalizeWeekdays(
    schedulingPreference?.preferred_weekdays as Prisma.JsonValue | null | undefined
  );
  if (
    preferredWeekdays.length > 0 &&
    candidateDates.some((date) => !preferredWeekdays.includes(date.getDay()))
  ) {
    return validationError('患者の希望曜日と一致しない定期訪問日が含まれています');
  }

  const mergedTimeWindow = intersectTimeWindows(
    { from: time_window_start, to: time_window_end },
    {
      from: toTimeString(schedulingPreference?.preferred_time_from),
      to: toTimeString(schedulingPreference?.preferred_time_to),
    },
    {
      from: toTimeString(schedulingPreference?.facility_time_from),
      to: toTimeString(schedulingPreference?.facility_time_to),
    }
  );
  if (mergedTimeWindow == null) {
    return validationError('患者在宅時間帯と施設受入時間帯が重ならないため訪問枠を確定できません');
  }

  // Check monthly visit count limits
  if (insurance_type && MONTHLY_LIMITS[insurance_type] !== undefined) {
    const limit = MONTHLY_LIMITS[insurance_type];
    const monthCounts: Record<string, number> = {};
    for (const d of candidateDates) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthCounts[key] = (monthCounts[key] ?? 0) + 1;
      if (monthCounts[key] > limit) {
        return validationError(
          `月間訪問回数の上限を超えています（${insurance_type === 'medical' ? '医療' : '介護'}保険: 月${limit}回まで）`
        );
      }
    }
  }

  if (insurance_type && WEEKLY_LIMITS[insurance_type] !== undefined) {
    const limit = WEEKLY_LIMITS[insurance_type];
    const weekCounts: Record<string, number> = {};
    for (const d of candidateDates) {
      const key = buildWeekKey(d);
      weekCounts[key] = (weekCounts[key] ?? 0) + 1;
      if (weekCounts[key] > limit) {
        return validationError(
          `週次訪問回数の上限を超えています（${insurance_type === 'medical' ? '医療' : '介護'}保険: 週${limit}回まで）`
        );
      }
    }
  }

  const schedules = await withOrgContext(req.orgId, async (tx) => {
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
            ...(mergedTimeWindow?.from
              ? { time_window_start: new Date(`1970-01-01T${mergedTimeWindow.from}`) }
              : {}),
            ...(mergedTimeWindow?.to
              ? { time_window_end: new Date(`1970-01-01T${mergedTimeWindow.to}`) }
              : {}),
            confirmed_at: new Date(),
            confirmed_by: req.userId,
          },
        })
      })
    );
    return created;
  });

  await notifyWorkflowMutation({
    orgId: req.orgId,
    payload: { source: 'visit_schedules_generate', case_id },
  });

  return success({ data: schedules, count: schedules.length }, 201);
}, {
  permission: 'canVisit',
  message: '訪問予定の自動生成権限がありません',
});
