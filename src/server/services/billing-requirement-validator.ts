/**
 * 算定要件バリデーター
 *
 * 訪問スケジュール提案作成時に呼ばれ、算定要件をチェックしてアラートを返す。
 * 全アラートは advisory（warning/info）または blocking（error）。
 * severity: 'error' のアラートは既存の validateProposalBillingExclusions が
 * ブロック判定に使用する。
 *
 * Count basis: VisitSchedule rows（BillingCandidate ではない）。
 * これは意図的な移行 — BillingCandidate は訪問後の会計レコードであり、
 * 提案作成時には存在しない場合がある。
 */

import type { ScheduleStatus } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { prisma } from '@/lib/db/client';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { findActiveVisitConsent, findCurrentManagementPlan } from './management-plans';
import { getBillingCadencePolicy } from './billing-runtime-context';

// ── Types ──

export type BillingAlertType =
  | 'monthly_cap_exceeded'
  | 'pharmacist_weekly_capacity'
  | 'emergency_regular_concurrent'
  | 'missing_management_plan'
  | 'consent_expired_or_missing'
  | 'special_patient_weekly_cap'
  | 'care_insurance_application_pending'
  | 'public_subsidy_application_pending';

export type BillingAlertSeverity = 'error' | 'warning' | 'info';

export type BillingRequirementAlert = {
  type: BillingAlertType;
  severity: BillingAlertSeverity;
  message: string;
  details: Record<string, unknown>;
  as_of: string;
};

export type ValidateBillingRequirementsArgs = {
  orgId: string;
  caseId: string;
  patientId: string;
  pharmacistId: string;
  visitType: string;
  proposedDate: Date;
  prescriptionCategory?: 'regular' | 'emergency';
  payerBasis: 'medical' | 'care' | 'mixed';
  specialCapEligible?: boolean;
};

export type BillingCadencePreview = {
  monthly_cap: number;
  current_month_count: number;
  remaining_month_count: number;
  weekly_cap: number | null;
  current_week_count: number;
  scheduled_dates_current_month: string[];
  next_billable_date: string | null;
  suggested_dates: string[];
  reason: string;
};

// ── Constants ──

const PHARMACIST_CAP_THRESHOLD = 0.95;

const ACTIVE_SCHEDULE_STATUSES: ScheduleStatus[] = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
  'completed',
];

const NEXT_DATE_SEARCH_DAYS = 120;

function startOfWeekMonday(value: Date) {
  return startOfWeek(value, { weekStartsOn: 1 });
}

function endOfWeekMonday(value: Date) {
  return endOfWeek(value, { weekStartsOn: 1 });
}

export async function getBillingCadencePreview(
  args: ValidateBillingRequirementsArgs,
): Promise<BillingCadencePreview> {
  const cadencePolicy = getBillingCadencePolicy();
  const monthlyCap = args.specialCapEligible
    ? cadencePolicy.monthlyCapSpecial
    : cadencePolicy.monthlyCapDefault;
  const weeklyCap = args.specialCapEligible ? cadencePolicy.specialWeeklyCap : null;
  const monthStart = startOfMonth(args.proposedDate);
  const monthEnd = endOfMonth(args.proposedDate);
  const searchEnd = new Date(args.proposedDate);
  searchEnd.setDate(searchEnd.getDate() + NEXT_DATE_SEARCH_DAYS);

  const schedules = await prisma.visitSchedule.findMany({
    where: {
      org_id: args.orgId,
      cycle: { patient_id: args.patientId },
      scheduled_date: {
        gte: monthStart,
        lte: searchEnd,
      },
      schedule_status: { in: ACTIVE_SCHEDULE_STATUSES },
    },
    select: {
      scheduled_date: true,
    },
    orderBy: [{ scheduled_date: 'asc' }],
  });

  const scheduledDatesCurrentMonth = schedules
    .filter(
      (schedule) => schedule.scheduled_date >= monthStart && schedule.scheduled_date <= monthEnd,
    )
    .map((schedule) => formatUtcDateKey(schedule.scheduled_date));

  const currentMonthCount = scheduledDatesCurrentMonth.length;
  const currentWeekStart = startOfWeekMonday(args.proposedDate);
  const currentWeekEnd = endOfWeekMonday(args.proposedDate);
  const currentWeekCount = schedules.filter(
    (schedule) =>
      schedule.scheduled_date >= currentWeekStart && schedule.scheduled_date <= currentWeekEnd,
  ).length;

  let nextBillableDate: Date | null = null;
  const suggestedDates: string[] = [];
  for (let offset = 0; offset <= NEXT_DATE_SEARCH_DAYS; offset += 1) {
    const candidate = new Date(args.proposedDate);
    candidate.setDate(candidate.getDate() + offset);
    const candidateMonthStart = startOfMonth(candidate);
    const candidateMonthEnd = endOfMonth(candidate);
    const monthCount = schedules.filter(
      (schedule) =>
        schedule.scheduled_date >= candidateMonthStart &&
        schedule.scheduled_date <= candidateMonthEnd,
    ).length;
    const candidateWeekCount =
      weeklyCap == null
        ? 0
        : schedules.filter((schedule) => {
            const weekStart = startOfWeekMonday(candidate);
            const weekEnd = endOfWeekMonday(candidate);
            return schedule.scheduled_date >= weekStart && schedule.scheduled_date <= weekEnd;
          }).length;

    const monthlyAvailable = monthCount < monthlyCap;
    const weeklyAvailable = weeklyCap == null || candidateWeekCount < weeklyCap;
    if (monthlyAvailable && weeklyAvailable) {
      if (!nextBillableDate) nextBillableDate = candidate;
      if (suggestedDates.length < 3) suggestedDates.push(formatUtcDateKey(candidate));
    }
    if (nextBillableDate && suggestedDates.length >= 3) break;
  }

  const remainingMonthCount = Math.max(monthlyCap - currentMonthCount, 0);
  const reason =
    nextBillableDate == null
      ? '120日以内に算定可能日を提案できませんでした'
      : nextBillableDate.toDateString() === args.proposedDate.toDateString()
        ? '本日以降で算定可能です'
        : `次回算定可能日は ${formatUtcDateKey(nextBillableDate)} です`;

  return {
    monthly_cap: monthlyCap,
    current_month_count: currentMonthCount,
    remaining_month_count: remainingMonthCount,
    weekly_cap: weeklyCap,
    current_week_count: currentWeekCount,
    scheduled_dates_current_month: scheduledDatesCurrentMonth,
    next_billable_date: nextBillableDate ? formatUtcDateKey(nextBillableDate) : null,
    suggested_dates: suggestedDates,
    reason,
  };
}

// ── Main Function ──

export async function validateBillingRequirements(
  args: ValidateBillingRequirementsArgs,
): Promise<BillingRequirementAlert[]> {
  const cadencePolicy = getBillingCadencePolicy();
  const asOf = new Date().toISOString();
  const alerts: BillingRequirementAlert[] = [];
  const monthStart = startOfMonth(args.proposedDate);
  const monthEnd = endOfMonth(args.proposedDate);
  const weekStart = startOfWeekMonday(args.proposedDate);
  const weekEnd = endOfWeekMonday(args.proposedDate);

  // Parallel data fetches
  const [
    monthlyScheduleCount,
    weeklyPharmacistCount,
    weeklyPatientCount,
    existingRegularInMonth,
    consent,
    managementPlan,
  ] = await Promise.all([
    // Monthly schedule count for patient
    prisma.visitSchedule.count({
      where: {
        org_id: args.orgId,
        cycle: { patient_id: args.patientId },
        scheduled_date: { gte: monthStart, lte: monthEnd },
        schedule_status: { in: ACTIVE_SCHEDULE_STATUSES },
      },
    }),
    // Weekly visit count for pharmacist
    prisma.visitSchedule.count({
      where: {
        org_id: args.orgId,
        pharmacist_id: args.pharmacistId,
        scheduled_date: { gte: weekStart, lte: weekEnd },
        schedule_status: { in: ACTIVE_SCHEDULE_STATUSES },
      },
    }),
    // Weekly visit count for patient (special cap check)
    args.specialCapEligible
      ? prisma.visitSchedule.count({
          where: {
            org_id: args.orgId,
            cycle: { patient_id: args.patientId },
            scheduled_date: { gte: weekStart, lte: weekEnd },
            schedule_status: { in: ACTIVE_SCHEDULE_STATUSES },
          },
        })
      : Promise.resolve(0),
    // Existing regular visits in month (for concurrent check)
    args.visitType === 'emergency'
      ? prisma.visitSchedule.count({
          where: {
            org_id: args.orgId,
            cycle: { patient_id: args.patientId },
            visit_type: 'regular',
            scheduled_date: { gte: monthStart, lte: monthEnd },
            schedule_status: { in: ACTIVE_SCHEDULE_STATUSES },
          },
        })
      : Promise.resolve(0),
    // Consent check
    findActiveVisitConsent(prisma, {
      orgId: args.orgId,
      patientId: args.patientId,
    }),
    // Management plan check
    findCurrentManagementPlan(prisma, {
      orgId: args.orgId,
      caseId: args.caseId,
    }),
  ]);

  // Also fetch pharmacist capacity setting
  const pharmacist = await prisma.user.findFirst({
    where: { id: args.pharmacistId },
    select: { max_weekly_visits: true },
  });

  const pharmacistWeeklyCap =
    pharmacist?.max_weekly_visits ?? cadencePolicy.weeklyPharmacistCapDefault;

  // ── Alert #1: Monthly cap exceeded ──
  const monthlyCap = args.specialCapEligible
    ? cadencePolicy.monthlyCapSpecial
    : cadencePolicy.monthlyCapDefault;
  const projectedMonthly = monthlyScheduleCount + 1; // +1 for new proposal

  if (projectedMonthly > monthlyCap) {
    alerts.push({
      type: 'monthly_cap_exceeded',
      severity: 'error',
      message: `この患者は今月既に${monthlyScheduleCount}回の訪問が予定されています。月上限${monthlyCap}回を超過します`,
      details: {
        current_count: monthlyScheduleCount,
        projected_count: projectedMonthly,
        cap: monthlyCap,
        special_cap_eligible: args.specialCapEligible ?? false,
      },
      as_of: asOf,
    });
  }

  // ── Alert #2: Pharmacist weekly capacity ──
  const projectedWeeklyPharmacist = weeklyPharmacistCount + 1;
  const capacityRatio = projectedWeeklyPharmacist / pharmacistWeeklyCap;

  if (capacityRatio >= PHARMACIST_CAP_THRESHOLD) {
    alerts.push({
      type: 'pharmacist_weekly_capacity',
      severity: 'warning',
      message: `この薬剤師は今週${weeklyPharmacistCount}件の訪問が予定されています。週上限${pharmacistWeeklyCap}件の${Math.round(capacityRatio * 100)}%です`,
      details: {
        current_count: weeklyPharmacistCount,
        projected_count: projectedWeeklyPharmacist,
        cap: pharmacistWeeklyCap,
        ratio: capacityRatio,
      },
      as_of: asOf,
    });
  }

  // ── Alert #3: Emergency/regular concurrent billing ──
  if (args.visitType === 'emergency' && existingRegularInMonth > 0) {
    alerts.push({
      type: 'emergency_regular_concurrent',
      severity: 'warning',
      message: `この患者は今月${existingRegularInMonth}回の定期訪問が予定されています。緊急訪問指導料との並算定制限にご注意ください`,
      details: {
        regular_count: existingRegularInMonth,
        payer_basis: args.payerBasis,
      },
      as_of: asOf,
    });
  }

  // ── Alert #4: Missing management plan ──
  if (!managementPlan.current) {
    alerts.push({
      type: 'missing_management_plan',
      severity: 'warning',
      message: '薬学的管理指導計画書が未作成または未承認です。算定には承認済みの計画書が必要です',
      details: { plan_exists: false },
      as_of: asOf,
    });
  } else if (managementPlan.current.status !== 'approved') {
    alerts.push({
      type: 'missing_management_plan',
      severity: 'warning',
      message: `薬学的管理指導計画書のステータスが「${managementPlan.current.status}」です。算定には承認済みの計画書が必要です`,
      details: {
        plan_exists: true,
        plan_id: managementPlan.current.id,
        status: managementPlan.current.status,
      },
      as_of: asOf,
    });
  } else if (managementPlan.reviewOverdue) {
    alerts.push({
      type: 'missing_management_plan',
      severity: 'warning',
      message: '薬学的管理指導計画書の見直し期限が過ぎています。更新を検討してください',
      details: {
        plan_exists: true,
        plan_id: managementPlan.current.id,
        review_overdue: true,
      },
      as_of: asOf,
    });
  }

  // ── Alert #5: Consent expired or missing ──
  if (!consent) {
    alerts.push({
      type: 'consent_expired_or_missing',
      severity: 'warning',
      message: '訪問薬剤管理指導の同意書が未取得です。算定には有効な同意書が必要です',
      details: { consent_exists: false },
      as_of: asOf,
    });
  } else if (consent.expiry_date && consent.expiry_date < args.proposedDate) {
    alerts.push({
      type: 'consent_expired_or_missing',
      severity: 'warning',
      message: `訪問予定日時点で同意書が${formatUtcDateKey(consent.expiry_date)}に期限切れです。更新が必要です`,
      details: {
        consent_exists: true,
        consent_id: consent.id,
        expiry_date: consent.expiry_date.toISOString(),
        proposed_date: args.proposedDate.toISOString(),
      },
      as_of: asOf,
    });
  }

  // ── Alert #6: Special patient weekly cap ──
  if (args.specialCapEligible) {
    const projectedWeeklyPatient = weeklyPatientCount + 1;

    if (projectedWeeklyPatient > cadencePolicy.specialWeeklyCap) {
      alerts.push({
        type: 'special_patient_weekly_cap',
        severity: 'warning',
        message: `特別対象患者です。今週既に${weeklyPatientCount}回の訪問が予定されています（週上限${cadencePolicy.specialWeeklyCap}回）`,
        details: {
          current_count: weeklyPatientCount,
          projected_count: projectedWeeklyPatient,
          cap: cadencePolicy.specialWeeklyCap,
        },
        as_of: asOf,
      });
    }
  }

  return alerts;
}
