import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, forbiddenResponse, success, validationError } from '@/lib/api/response';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { buildOperatingCalendarFromDbRows } from '@/lib/calendar/operating-day-adapter';
import { resolveOperatingState } from '@/lib/calendar/operating-day';
import { generateVisitSchedulesSchema } from '@/lib/validations/visit-schedule';
import { parseSimpleRruleDates } from '@/lib/visits/rrule';
import { hhmmToTimeDate } from '@/lib/datetime/time-of-day';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { prisma } from '@/lib/db/client';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES as OPEN_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import {
  evaluateVisitWorkflowGates,
  formatVisitWorkflowGateIssues,
} from '@/server/services/management-plans';
import { resolveBillingPayerBasis } from '@/server/services/billing-payer-basis';
import { validateScheduleTimeStringsFitShift } from '@/server/services/visit-schedule-shift';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { formatUtcDateKey } from '@/lib/date-key';

// Insurance visit frequency limits: medical=4/month, care=2/month
const MONTHLY_LIMITS: Record<string, number> = {
  medical: 4,
  care: 2,
};

const WEEKLY_LIMITS: Record<string, number> = {
  medical: 1,
  care: 1,
};

const MAX_GENERATED_VISIT_SCHEDULE_RANGE_DAYS = 120;
const MAX_GENERATED_VISIT_SCHEDULE_CANDIDATES = 100;
const SCHEDULABLE_CYCLE_STATUSES = ['audited', 'setting', 'set_audited', 'visit_ready'] as const;
const SCHEDULE_GENERATE_SERIALIZABLE_RETRY_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

class VisitScheduleGenerateRetryLimitError extends Error {
  constructor() {
    super('visit schedule generation transaction retry limit exceeded');
    this.name = 'VisitScheduleGenerateRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

async function withSerializableScheduleGenerateTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < SCHEDULE_GENERATE_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === SCHEDULE_GENERATE_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new VisitScheduleGenerateRetryLimitError();
      }
    }
  }

  throw new VisitScheduleGenerateRetryLimitError();
}

function normalizeWeekdays(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (entry): entry is number => typeof entry === 'number' && entry >= 0 && entry <= 6,
      ),
    ),
  );
}

type GeneratedVisitOperatingDayViolation = {
  dateKey: string;
  siteId: string;
  reason: 'holiday' | 'regular_closed';
};

function operatingDayClosedReasonLabel(reason: GeneratedVisitOperatingDayViolation['reason']) {
  return reason === 'holiday' ? '休業日' : '定休日';
}

function operatingDayClosedMessage(violation: GeneratedVisitOperatingDayViolation) {
  return `${violation.dateKey}: 訪問拠点が${operatingDayClosedReasonLabel(
    violation.reason,
  )}のため訪問予定を生成できません。生成するには上書き理由を入力してください`;
}

function toTimeString(value: Date | null | undefined) {
  return timeDateToString(value);
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

function utcDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function differenceInUtcCalendarDays(later: Date, earlier: Date) {
  return Math.round((utcDateOnly(later).getTime() - utcDateOnly(earlier).getTime()) / DAY_MS);
}

function buildWeekKey(value: Date) {
  const weekStart = utcDateOnly(value);
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);
  return formatUtcDateKey(weekStart);
}

function buildDateKey(value: Date) {
  return formatUtcDateKey(value);
}

type LimitInsuranceType = keyof typeof MONTHLY_LIMITS;

function isLimitInsuranceType(value: string): value is LimitInsuranceType {
  return Object.prototype.hasOwnProperty.call(MONTHLY_LIMITS, value);
}

function formatInsuranceLimitLabel(value: LimitInsuranceType) {
  return value === 'medical' ? '医療' : '介護';
}

type ScheduleLimitInsuranceRecord = {
  insurance_type: LimitInsuranceType;
  number: string | null;
  valid_from: Date | null;
  valid_until: Date | null;
  created_at: Date;
};

type GeneratedVisitShift = {
  date: Date;
  site_id: string | null;
  available: boolean;
  available_from: Date | null;
  available_to: Date | null;
};

function isInsuranceRecordEffective(record: ScheduleLimitInsuranceRecord, asOf: Date) {
  return (
    (record.valid_from == null || record.valid_from <= asOf) &&
    (record.valid_until == null || record.valid_until >= asOf)
  );
}

function compareEffectiveInsuranceRecords(
  left: ScheduleLimitInsuranceRecord,
  right: ScheduleLimitInsuranceRecord,
) {
  const leftValidFrom = left.valid_from?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightValidFrom = right.valid_from?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (leftValidFrom !== rightValidFrom) return rightValidFrom - leftValidFrom;
  return right.created_at.getTime() - left.created_at.getTime();
}

async function resolveScheduleLimitInsuranceTypes(args: {
  orgId: string;
  patientId: string;
  visitType: string;
  dates: Date[];
}): Promise<Array<LimitInsuranceType | null>> {
  if (args.dates.length === 0) return [];

  const normalizedDates = args.dates.map((date) => utcDateFromLocalKey(localDateKey(date)));
  const minDate = new Date(Math.min(...normalizedDates.map((date) => date.getTime())));
  const maxDate = new Date(Math.max(...normalizedDates.map((date) => date.getTime())));

  const insuranceRecords = (await prisma.patientInsurance.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      insurance_type: { in: ['medical', 'care'] },
      is_active: true,
      OR: [{ valid_from: null }, { valid_from: { lte: maxDate } }],
      AND: [{ OR: [{ valid_until: null }, { valid_until: { gte: minDate } }] }],
    },
    select: {
      insurance_type: true,
      number: true,
      valid_from: true,
      valid_until: true,
      created_at: true,
    },
  })) as ScheduleLimitInsuranceRecord[];

  const recordsByType = new Map<LimitInsuranceType, ScheduleLimitInsuranceRecord[]>();
  for (const record of insuranceRecords) {
    if (!isLimitInsuranceType(record.insurance_type)) continue;
    const records = recordsByType.get(record.insurance_type) ?? [];
    records.push(record);
    recordsByType.set(record.insurance_type, records);
  }
  for (const records of recordsByType.values()) {
    records.sort(compareEffectiveInsuranceRecords);
  }

  return normalizedDates.map((date) => {
    const medicalInsurance =
      recordsByType.get('medical')?.find((record) => isInsuranceRecordEffective(record, date)) ??
      null;
    const careInsurance =
      recordsByType.get('care')?.find((record) => isInsuranceRecordEffective(record, date)) ?? null;

    const payerBasis = resolveBillingPayerBasis({
      medicalInsuranceNumber: medicalInsurance?.number ?? null,
      careInsuranceNumber: careInsurance?.number ?? null,
      visitType: args.visitType,
    });

    return isLimitInsuranceType(payerBasis) ? payerBasis : null;
  });
}

async function validateGeneratedVisitVehicleResource(args: {
  orgId: string;
  vehicleResourceId: string;
  candidateDates: Date[];
  shiftByDate: Map<string, GeneratedVisitShift>;
}) {
  const vehicleResource = await prisma.visitVehicleResource.findFirst({
    where: {
      org_id: args.orgId,
      id: args.vehicleResourceId,
      available: true,
    },
    select: {
      id: true,
      site_id: true,
      label: true,
      max_stops: true,
    },
  });
  if (!vehicleResource) {
    return validationError('選択した車両リソースが見つからないか利用できません');
  }

  for (const candidateDate of args.candidateDates) {
    const shift = args.shiftByDate.get(buildDateKey(candidateDate));
    if (!shift?.site_id) {
      return validationError('車両リソースを指定する場合は訪問拠点が必要です');
    }
    if (vehicleResource.site_id !== shift.site_id) {
      return validationError('選択した車両リソースは訪問予定の拠点では利用できません');
    }
  }

  if (vehicleResource.max_stops == null) return null;

  const existingSchedules = await prisma.visitSchedule.findMany({
    where: {
      org_id: args.orgId,
      vehicle_resource_id: args.vehicleResourceId,
      scheduled_date: { in: args.candidateDates },
      schedule_status: {
        notIn: ['cancelled', 'rescheduled'],
      },
    },
    select: {
      scheduled_date: true,
    },
  });
  const countByDate = new Map<string, number>();
  for (const schedule of existingSchedules) {
    const dateKey = buildDateKey(schedule.scheduled_date);
    countByDate.set(dateKey, (countByDate.get(dateKey) ?? 0) + 1);
  }
  for (const candidateDate of args.candidateDates) {
    const dateKey = buildDateKey(candidateDate);
    const nextCount = (countByDate.get(dateKey) ?? 0) + 1;
    countByDate.set(dateKey, nextCount);
    if (nextCount > vehicleResource.max_stops) {
      return validationError(
        `${vehicleResource.label} で訪問できる件数は最大 ${vehicleResource.max_stops} 件です`,
      );
    }
  }

  return null;
}

export const POST = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = generateVisitSchedulesSchema.safeParse(payload);
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
      vehicle_resource_id,
      operating_day_override_reason,
    } = parsed.data;

    const startDate = utcDateFromLocalKey(start_date);
    const endDate = utcDateFromLocalKey(end_date);

    if (startDate > endDate) {
      return validationError('開始日は終了日以前である必要があります');
    }

    if (differenceInUtcCalendarDays(endDate, startDate) > MAX_GENERATED_VISIT_SCHEDULE_RANGE_DAYS) {
      return validationError('訪問予定の一括生成期間は120日以内にしてください');
    }

    const candidateDates = parseSimpleRruleDates(recurrence_rule, startDate, endDate);

    if (candidateDates.length === 0) {
      return validationError('指定されたRRULEから日程を生成できませんでした');
    }

    if (candidateDates.length > MAX_GENERATED_VISIT_SCHEDULE_CANDIDATES) {
      return validationError('一度に生成できる訪問予定は100件までです');
    }

    const careCase = await prisma.careCase.findFirst({
      where: {
        id: case_id,
        org_id: ctx.orgId,
      },
      select: {
        patient_id: true,
        primary_pharmacist_id: true,
        backup_pharmacist_id: true,
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
    if (
      !canAccessVisitScheduleAssignment(ctx, {
        pharmacist_id,
        case_: careCase,
      })
    ) {
      return forbiddenResponse('このケースまたは担当薬剤師で訪問予定を生成する権限がありません');
    }

    const workflowGates = await evaluateVisitWorkflowGates(prisma, {
      orgId: ctx.orgId,
      patientId: careCase.patient_id,
      caseId: case_id,
      asOfDates: candidateDates,
    });
    for (const [index, gate] of workflowGates.entries()) {
      if (!gate.ok) {
        const candidateDate = candidateDates[index]!;
        return validationError(
          `${buildDateKey(candidateDate)}: ${formatVisitWorkflowGateIssues(gate.issues)}`,
        );
      }
    }

    const medicationCycle = await prisma.medicationCycle.findFirst({
      where: {
        org_id: ctx.orgId,
        case_id,
        overall_status: { in: [...SCHEDULABLE_CYCLE_STATUSES] },
      },
      orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
      select: { id: true, overall_status: true },
    });
    if (!medicationCycle) {
      return validationError(
        '訪問予定に紐付けられる処方サイクルがありません。セット監査まで完了した処方を確認してください',
      );
    }

    const schedulingPreference = careCase.patient.scheduling_preference;
    const preferredWeekdays = normalizeWeekdays(schedulingPreference?.preferred_weekdays);
    if (
      preferredWeekdays.length > 0 &&
      candidateDates.some((date) => !preferredWeekdays.includes(date.getUTCDay()))
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
      },
    );
    if (mergedTimeWindow == null) {
      return validationError(
        '患者在宅時間帯と施設受入時間帯が重ならないため訪問枠を確定できません',
      );
    }

    const shifts = await prisma.pharmacistShift.findMany({
      where: {
        org_id: ctx.orgId,
        user_id: pharmacist_id,
        date: { in: candidateDates },
      },
      select: {
        date: true,
        site_id: true,
        available: true,
        available_from: true,
        available_to: true,
      },
    });
    const shiftByDate = new Map(shifts.map((shift) => [buildDateKey(shift.date), shift]));
    for (const candidateDate of candidateDates) {
      const dateKey = buildDateKey(candidateDate);
      const shift = shiftByDate.get(dateKey) ?? null;
      if (!shift) {
        return validationError(`${dateKey}: 選択した薬剤師のシフトがありません`);
      }
      if (!shift.site_id) {
        return validationError(`${dateKey}: 選択した薬剤師のシフトに訪問拠点がありません`);
      }
      const shiftValidationError = validateScheduleTimeStringsFitShift(
        shift,
        mergedTimeWindow.from,
        mergedTimeWindow.to,
      );
      if (shiftValidationError) {
        return validationError(`${dateKey}: ${shiftValidationError}`);
      }
    }

    const siteIds = Array.from(
      new Set(shifts.map((shift) => shift.site_id).filter((siteId): siteId is string => !!siteId)),
    );
    const [operatingWeeklyRows, operatingHolidayRows] = await Promise.all([
      prisma.pharmacyOperatingHours.findMany({
        where: {
          org_id: ctx.orgId,
          site_id: { in: siteIds },
        },
        select: {
          id: true,
          site_id: true,
          weekday: true,
          is_open: true,
          open_time: true,
          close_time: true,
          note: true,
        },
      }),
      prisma.businessHoliday.findMany({
        where: {
          org_id: ctx.orgId,
          date: { in: candidateDates },
          OR: [{ site_id: { in: siteIds } }, { site_id: null }],
        },
        select: {
          id: true,
          site_id: true,
          date: true,
          name: true,
          holiday_type: true,
          is_closed: true,
          open_time: true,
          close_time: true,
        },
      }),
    ]);
    const operatingCalendarBySite = new Map(
      siteIds.map((siteId) => [
        siteId,
        buildOperatingCalendarFromDbRows(
          siteId,
          operatingWeeklyRows.filter((row) => row.site_id === siteId),
          operatingHolidayRows.filter((row) => row.site_id === null || row.site_id === siteId),
        ),
      ]),
    );
    const operatingDayViolations: GeneratedVisitOperatingDayViolation[] = [];
    for (const candidateDate of candidateDates) {
      const dateKey = buildDateKey(candidateDate);
      const shift = shiftByDate.get(dateKey);
      if (!shift?.site_id) continue;
      const calendar = operatingCalendarBySite.get(shift.site_id);
      if (!calendar) continue;
      const operatingState = resolveOperatingState(calendar, dateKey);
      if (!operatingState.open) {
        operatingDayViolations.push({
          dateKey,
          siteId: shift.site_id,
          reason: operatingState.reason,
        });
      }
    }
    if (operatingDayViolations.length > 0 && !operating_day_override_reason) {
      return validationError(operatingDayClosedMessage(operatingDayViolations[0]!));
    }
    const operatingDayViolationByDate = new Map(
      operatingDayViolations.map((violation) => [violation.dateKey, violation]),
    );

    if (vehicle_resource_id) {
      const vehicleValidationError = await validateGeneratedVisitVehicleResource({
        orgId: ctx.orgId,
        vehicleResourceId: vehicle_resource_id,
        candidateDates,
        shiftByDate,
      });
      if (vehicleValidationError) return vehicleValidationError;
    }

    const scheduleLimitTypes = await resolveScheduleLimitInsuranceTypes({
      orgId: ctx.orgId,
      patientId: careCase.patient_id,
      visitType: visit_type,
      dates: candidateDates,
    });

    const monthCounts: Record<string, number> = {};
    const weekCounts: Record<string, number> = {};
    for (const [index, candidateDate] of candidateDates.entries()) {
      const insuranceType = scheduleLimitTypes[index];
      if (!insuranceType) continue;

      const monthKey = `${insuranceType}:${candidateDate.getUTCFullYear()}-${candidateDate.getUTCMonth()}`;
      monthCounts[monthKey] = (monthCounts[monthKey] ?? 0) + 1;
      const monthlyLimit = MONTHLY_LIMITS[insuranceType];
      if (monthCounts[monthKey] > monthlyLimit) {
        return validationError(
          `月間訪問回数の上限を超えています（${formatInsuranceLimitLabel(insuranceType)}保険: 月${monthlyLimit}回まで）`,
        );
      }

      const weekKey = `${insuranceType}:${buildWeekKey(candidateDate)}`;
      weekCounts[weekKey] = (weekCounts[weekKey] ?? 0) + 1;
      const weeklyLimit = WEEKLY_LIMITS[insuranceType];
      if (weekCounts[weekKey] > weeklyLimit) {
        return validationError(
          `週次訪問回数の上限を超えています（${formatInsuranceLimitLabel(insuranceType)}保険: 週${weeklyLimit}回まで）`,
        );
      }
    }

    const result = await withSerializableScheduleGenerateTransaction(ctx.orgId, async (tx) => {
      const duplicateScheduleCount = await tx.visitSchedule.count({
        where: {
          org_id: ctx.orgId,
          case_id,
          cycle_id: medicationCycle.id,
          visit_type,
          scheduled_date: { in: candidateDates },
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
      });
      if (duplicateScheduleCount > 0) {
        return {
          error: 'duplicate_schedule' as const,
        };
      }

      const existingRouteOrders = await tx.visitSchedule.findMany({
        where: {
          org_id: ctx.orgId,
          pharmacist_id,
          scheduled_date: { in: candidateDates },
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
          route_order: { not: null },
        },
        select: {
          scheduled_date: true,
          route_order: true,
        },
      });
      const existingProposalRouteOrders = await tx.visitScheduleProposal.findMany({
        where: {
          org_id: ctx.orgId,
          finalized_schedule_id: null,
          proposal_status: { in: OPEN_PROPOSAL_STATUSES },
          proposed_pharmacist_id: pharmacist_id,
          proposed_date: { in: candidateDates },
          route_order: { not: null },
        },
        select: {
          proposed_date: true,
          route_order: true,
        },
      });
      const maxRouteOrderByDate = new Map<string, number>();
      for (const schedule of existingRouteOrders) {
        const routeOrder = schedule.route_order ?? 0;
        const dateKey = buildDateKey(schedule.scheduled_date);
        maxRouteOrderByDate.set(
          dateKey,
          Math.max(maxRouteOrderByDate.get(dateKey) ?? 0, routeOrder),
        );
      }
      for (const proposal of existingProposalRouteOrders) {
        const routeOrder = proposal.route_order ?? 0;
        const dateKey = buildDateKey(proposal.proposed_date);
        maxRouteOrderByDate.set(
          dateKey,
          Math.max(maxRouteOrderByDate.get(dateKey) ?? 0, routeOrder),
        );
      }

      const created = await Promise.all(
        candidateDates.map(async (date) => {
          const dateKey = buildDateKey(date);
          const shift = shiftByDate.get(dateKey);
          const routeOrder = (maxRouteOrderByDate.get(dateKey) ?? 0) + 1;
          maxRouteOrderByDate.set(dateKey, routeOrder);

          return tx.visitSchedule.create({
            data: {
              org_id: ctx.orgId,
              case_id,
              cycle_id: medicationCycle.id,
              visit_type,
              priority: 'normal',
              pharmacist_id,
              site_id: shift?.site_id ?? null,
              vehicle_resource_id: vehicle_resource_id ?? null,
              assignment_mode:
                careCase?.primary_pharmacist_id && careCase.primary_pharmacist_id === pharmacist_id
                  ? 'primary'
                  : 'fallback',
              scheduled_date: date,
              route_order: routeOrder,
              recurrence_rule,
              ...(mergedTimeWindow?.from
                ? { time_window_start: hhmmToTimeDate(mergedTimeWindow.from) }
                : {}),
              ...(mergedTimeWindow?.to
                ? { time_window_end: hhmmToTimeDate(mergedTimeWindow.to) }
                : {}),
              confirmed_at: new Date(),
              confirmed_by: ctx.userId,
            },
          });
        }),
      );
      if (operating_day_override_reason && operatingDayViolationByDate.size > 0) {
        for (const [index, schedule] of created.entries()) {
          const dateKey = buildDateKey(candidateDates[index]!);
          const violation = operatingDayViolationByDate.get(dateKey);
          if (!violation) continue;
          await createAuditLogEntry(tx, ctx, {
            action: 'visit_schedule_operating_day_override_applied',
            targetType: 'VisitSchedule',
            targetId: schedule.id,
            patientId: careCase.patient_id,
            changes: {
              case_id,
              cycle_id: medicationCycle.id,
              scheduled_date: dateKey,
              pharmacist_id,
              site_id: violation.siteId,
              operating_day_reason: violation.reason,
              override_reason: operating_day_override_reason,
              recurrence_rule,
            },
          });
        }
      }
      return created;
    }).catch((cause: unknown) => {
      if (cause instanceof VisitScheduleGenerateRetryLimitError) {
        return { error: 'serialization_conflict' as const };
      }
      throw cause;
    });

    if ('error' in result) {
      if (result.error === 'duplicate_schedule') {
        return conflict('同一ケース・同一日付の訪問予定が既に存在します。再読み込みしてください');
      }
      return conflict('訪問予定の生成が同時に更新されました。再読み込みしてください');
    }

    const schedules = result;

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedules_generate', case_id },
    });

    return success({ data: schedules, count: schedules.length }, 201);
  },
  {
    permission: 'canVisit',
    message: '訪問予定の自動生成権限がありません',
  },
);
