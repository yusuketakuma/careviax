import { format, startOfWeek } from 'date-fns';
import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { forbiddenResponse, success, validationError } from '@/lib/api/response';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { generateVisitSchedulesSchema } from '@/lib/validations/visit-schedule';
import { parseSimpleRruleDates } from '@/lib/visits/rrule';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { prisma } from '@/lib/db/client';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES as OPEN_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import {
  evaluateVisitWorkflowGate,
  formatVisitWorkflowGateIssues,
} from '@/server/services/management-plans';
import { resolveBillingPayerBasis } from '@/server/services/billing-payer-basis';
import { resolvePatientInsurance } from '@/server/services/patient-insurance';
import { validateScheduleTimeStringsFitShift } from '@/server/services/visit-schedule-shift';
import { validateVisitVehicleResourceForSchedule } from '@/server/services/visit-schedule-service';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

// Insurance visit frequency limits: medical=4/month, care=2/month
const MONTHLY_LIMITS: Record<string, number> = {
  medical: 4,
  care: 2,
};

const WEEKLY_LIMITS: Record<string, number> = {
  medical: 1,
  care: 1,
};

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

function buildWeekKey(value: Date) {
  return format(startOfWeek(value, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function buildDateKey(value: Date) {
  return format(value, 'yyyy-MM-dd');
}

type LimitInsuranceType = keyof typeof MONTHLY_LIMITS;

function isLimitInsuranceType(value: string): value is LimitInsuranceType {
  return Object.prototype.hasOwnProperty.call(MONTHLY_LIMITS, value);
}

function formatInsuranceLimitLabel(value: LimitInsuranceType) {
  return value === 'medical' ? '医療' : '介護';
}

async function resolveScheduleLimitInsuranceType(args: {
  orgId: string;
  patientId: string;
  visitType: string;
  asOf: Date;
}) {
  const [medicalInsurance, careInsurance] = await Promise.all([
    resolvePatientInsurance(prisma, {
      orgId: args.orgId,
      patientId: args.patientId,
      type: 'medical',
      asOf: args.asOf,
    }),
    resolvePatientInsurance(prisma, {
      orgId: args.orgId,
      patientId: args.patientId,
      type: 'care',
      asOf: args.asOf,
    }),
  ]);

  const payerBasis = resolveBillingPayerBasis({
    medicalInsuranceNumber: medicalInsurance?.number ?? null,
    careInsuranceNumber: careInsurance?.number ?? null,
    visitType: args.visitType,
  });

  return isLimitInsuranceType(payerBasis) ? payerBasis : null;
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
    } = parsed.data;

    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    if (startDate > endDate) {
      return validationError('開始日は終了日以前である必要があります');
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

    const candidateDates = parseSimpleRruleDates(recurrence_rule, startDate, endDate);

    if (candidateDates.length === 0) {
      return validationError('指定されたRRULEから日程を生成できませんでした');
    }

    const workflowGates = await Promise.all(
      candidateDates.map((candidateDate) =>
        evaluateVisitWorkflowGate(prisma, {
          orgId: ctx.orgId,
          patientId: careCase.patient_id,
          caseId: case_id,
          asOf: candidateDate,
        }),
      ),
    );
    for (const [index, gate] of workflowGates.entries()) {
      if (!gate.ok) {
        const candidateDate = candidateDates[index]!;
        return validationError(
          `${format(candidateDate, 'yyyy-MM-dd')}: ${formatVisitWorkflowGateIssues(gate.issues)}`,
        );
      }
    }

    const schedulingPreference = careCase.patient.scheduling_preference;
    const preferredWeekdays = normalizeWeekdays(schedulingPreference?.preferred_weekdays);
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
      const shiftValidationError = validateScheduleTimeStringsFitShift(
        shift,
        mergedTimeWindow.from,
        mergedTimeWindow.to,
      );
      if (shiftValidationError) {
        return validationError(`${dateKey}: ${shiftValidationError}`);
      }
      if (vehicle_resource_id) {
        const vehicleValidation = await validateVisitVehicleResourceForSchedule(prisma, {
          orgId: ctx.orgId,
          vehicleResourceId: vehicle_resource_id,
          siteId: shift.site_id ?? null,
          scheduledDate: candidateDate,
        });
        if (!vehicleValidation.ok) return vehicleValidation.response;
      }
    }

    const scheduleLimitTypes = await Promise.all(
      candidateDates.map((date) =>
        resolveScheduleLimitInsuranceType({
          orgId: ctx.orgId,
          patientId: careCase.patient_id,
          visitType: visit_type,
          asOf: date,
        }),
      ),
    );

    const monthCounts: Record<string, number> = {};
    const weekCounts: Record<string, number> = {};
    for (const [index, candidateDate] of candidateDates.entries()) {
      const insuranceType = scheduleLimitTypes[index];
      if (!insuranceType) continue;

      const monthKey = `${insuranceType}:${candidateDate.getFullYear()}-${candidateDate.getMonth()}`;
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

    const schedules = await withOrgContext(ctx.orgId, async (tx) => {
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
                ? { time_window_start: new Date(`1970-01-01T${mergedTimeWindow.from}`) }
                : {}),
              ...(mergedTimeWindow?.to
                ? { time_window_end: new Date(`1970-01-01T${mergedTimeWindow.to}`) }
                : {}),
              confirmed_at: new Date(),
              confirmed_by: ctx.userId,
            },
          });
        }),
      );
      return created;
    });

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
