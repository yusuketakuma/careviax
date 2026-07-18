/**
 * 算定要件バリデーター
 *
 * 訪問スケジュール提案作成時に呼ばれ、算定要件をチェックしてアラートを返す。
 * 全アラートは advisory（warning/info）または blocking（error）。
 * severity: 'error' のアラートは既存の validateProposalBillingExclusions が
 * ブロック判定に使用する。
 *
 * Count basis: VisitSchedule rows plus open VisitScheduleProposal occupancy
 * reservations（BillingCandidate ではない）。これは意図的な移行 —
 * BillingCandidate は訪問後の会計レコードであり、提案作成時には存在しない場合がある。
 */

import { formatUtcDateKey } from '@/lib/date-key';
import { prisma } from '@/lib/db/client';
import { addUtcDays } from '@/lib/utils/date-boundary';
import { findActiveVisitConsent, findCurrentManagementPlan } from './management-plans';
import { getBillingCadencePolicy } from './billing-runtime-context';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import {
  ACTIVE_BILLING_SCHEDULE_STATUSES,
  buildBillingMonthKey,
  buildBillingWeekKey,
  endOfBillingMonth,
  endOfBillingWeek,
  startOfBillingDay,
  startOfBillingMonth,
  startOfBillingWeek,
} from './billing-cadence';

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
  excludeScheduleId?: string;
  excludeProposalId?: string;
  excludeSupersededProposalScope?: {
    caseId: string;
    rescheduleSourceScheduleId?: string | null;
  };
  prescriptionCategory?: 'regular' | 'emergency';
  payerBasis: 'medical' | 'care' | 'mixed';
  specialCapEligible?: boolean;
  pharmacistWeeklyCap?: number | null;
  cadenceScheduleRows?: BillingCadenceScheduleRow[];
  cadenceProposalRows?: BillingCadenceProposalRow[];
  workflowSnapshot?: BillingRequirementWorkflowSnapshot;
  db?: BillingRequirementDb;
};

type ConsentRecordDelegate = {
  findFirst(args: unknown): Promise<{
    id: string;
    expiry_date?: Date | null;
    obtained_date?: Date | null;
  } | null>;
};

type ManagementPlanDelegate = {
  findFirst(args: unknown): Promise<{
    id: string;
    status?: string;
    next_review_date: Date | null;
    effective_from?: Date | null;
    version?: number;
    approved_at?: Date | null;
  } | null>;
};

export type BillingRequirementDb = {
  visitSchedule: {
    findMany(args: unknown): Promise<unknown[]>;
    count(args: unknown): Promise<number>;
  };
  visitScheduleProposal: {
    findMany(args: unknown): Promise<unknown[]>;
  };
  user: {
    findFirst(args: unknown): Promise<{ max_weekly_visits: number | null } | null>;
  };
  consentRecord: ConsentRecordDelegate;
  managementPlan: ManagementPlanDelegate;
};

export type BillingCadenceScheduleRow = {
  id?: string | null;
  patient_id: string;
  scheduled_date: Date;
  pharmacist_id?: string | null;
  visit_type?: string | null;
};

export type BillingCadenceProposalRow = {
  id: string;
  case_id?: string | null;
  patient_id: string;
  proposed_date: Date;
  proposed_pharmacist_id?: string | null;
  visit_type?: string | null;
  proposal_batch_id?: string | null;
  finalized_schedule_id?: string | null;
  reschedule_source_schedule_id?: string | null;
};

export type BillingRequirementConsentSnapshot = {
  id: string;
  expiry_date?: Date | null;
};

export type BillingRequirementManagementPlanSnapshot = {
  current: {
    id: string;
    status?: string;
  } | null;
  reviewOverdue: boolean;
};

export type BillingRequirementWorkflowSnapshot = {
  resolveConsent(args: { patientId: string; asOf: Date }): BillingRequirementConsentSnapshot | null;
  resolveManagementPlan(args: {
    caseId: string;
    asOf: Date;
  }): BillingRequirementManagementPlanSnapshot;
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

const NEXT_DATE_SEARCH_DAYS = 120;

function dateBucketKey(value: Date): number {
  return value.getTime();
}

function incrementCount(counts: Map<number, number>, key: number): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function countScheduleRows(
  rows: BillingCadenceScheduleRow[],
  predicate: (row: BillingCadenceScheduleRow) => boolean,
  args?: { excludeScheduleId?: string },
): number {
  let count = 0;
  for (const row of rows) {
    if (args?.excludeScheduleId && row.id === args.excludeScheduleId) continue;
    if (predicate(row)) count += 1;
  }
  return count;
}

function isCountableProposalRow(
  row: BillingCadenceProposalRow,
  args: {
    excludeProposalId?: string;
    excludeScheduleId?: string;
    excludeSupersededProposalScope?: {
      caseId: string;
      rescheduleSourceScheduleId?: string | null;
    };
  },
) {
  if (args.excludeProposalId && row.id === args.excludeProposalId) return false;
  const supersededScope = args.excludeSupersededProposalScope;
  if (
    supersededScope &&
    row.case_id === supersededScope.caseId &&
    (supersededScope.rescheduleSourceScheduleId
      ? row.reschedule_source_schedule_id === supersededScope.rescheduleSourceScheduleId
      : row.reschedule_source_schedule_id == null)
  ) {
    return false;
  }
  if (row.finalized_schedule_id) return false;
  if (
    row.reschedule_source_schedule_id &&
    row.reschedule_source_schedule_id !== args.excludeScheduleId
  ) {
    return false;
  }
  return true;
}

function countProposalRows(
  rows: BillingCadenceProposalRow[],
  predicate: (row: BillingCadenceProposalRow) => boolean,
  bucketKey: (row: BillingCadenceProposalRow) => string,
  args: {
    excludeProposalId?: string;
    excludeScheduleId?: string;
    excludeSupersededProposalScope?: {
      caseId: string;
      rescheduleSourceScheduleId?: string | null;
    };
  },
): number {
  const counted = new Set<string>();
  for (const row of rows) {
    if (!isCountableProposalRow(row, args) || !predicate(row)) continue;
    const key = row.proposal_batch_id
      ? `batch:${row.proposal_batch_id}:${bucketKey(row)}`
      : `proposal:${row.id}`;
    counted.add(key);
  }
  return counted.size;
}

async function loadBillingCadenceProposalRows(args: {
  db?: BillingRequirementDb;
  orgId: string;
  patientId: string;
  pharmacistId: string;
  dateFrom: Date;
  dateTo: Date;
}): Promise<BillingCadenceProposalRow[]> {
  const db = args.db ?? prisma;
  const proposals = (await db.visitScheduleProposal.findMany({
    where: {
      org_id: args.orgId,
      finalized_schedule_id: null,
      proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
      proposed_date: {
        gte: args.dateFrom,
        lte: args.dateTo,
      },
      OR: [
        {
          case_: {
            patient_id: args.patientId,
          },
        },
        {
          proposed_pharmacist_id: args.pharmacistId,
        },
      ],
    },
    select: {
      id: true,
      case_id: true,
      proposal_batch_id: true,
      proposed_date: true,
      proposed_pharmacist_id: true,
      visit_type: true,
      finalized_schedule_id: true,
      reschedule_source_schedule_id: true,
      case_: {
        select: {
          patient_id: true,
        },
      },
    },
  })) as Array<{
    id: string;
    case_id: string;
    proposal_batch_id: string | null;
    proposed_date: Date;
    proposed_pharmacist_id: string | null;
    visit_type: string | null;
    finalized_schedule_id: string | null;
    reschedule_source_schedule_id: string | null;
    case_: {
      patient_id: string;
    };
  }>;

  return proposals.map((proposal) => ({
    id: proposal.id,
    case_id: proposal.case_id,
    patient_id: proposal.case_.patient_id,
    proposed_date: proposal.proposed_date,
    proposed_pharmacist_id: proposal.proposed_pharmacist_id,
    visit_type: proposal.visit_type,
    proposal_batch_id: proposal.proposal_batch_id,
    finalized_schedule_id: proposal.finalized_schedule_id,
    reschedule_source_schedule_id: proposal.reschedule_source_schedule_id,
  }));
}

export async function getBillingCadencePreview(
  args: ValidateBillingRequirementsArgs,
): Promise<BillingCadencePreview> {
  const db = (args.db ?? prisma) as BillingRequirementDb;
  const cadencePolicy = getBillingCadencePolicy();
  const monthlyCap = args.specialCapEligible
    ? cadencePolicy.monthlyCapSpecial
    : cadencePolicy.monthlyCapDefault;
  const weeklyCap = args.specialCapEligible ? cadencePolicy.specialWeeklyCap : null;
  const monthStart = startOfBillingMonth(args.proposedDate);
  const monthEnd = endOfBillingMonth(args.proposedDate);
  const proposedBillingDay = startOfBillingDay(args.proposedDate);
  const searchEnd = addUtcDays(proposedBillingDay, NEXT_DATE_SEARCH_DAYS);

  const schedules =
    args.cadenceScheduleRows?.filter(
      (row) =>
        (!args.excludeScheduleId || row.id !== args.excludeScheduleId) &&
        row.patient_id === args.patientId &&
        row.scheduled_date >= monthStart &&
        row.scheduled_date <= searchEnd,
    ) ??
    (
      (await db.visitSchedule.findMany({
        where: {
          org_id: args.orgId,
          case_: { patient_id: args.patientId },
          ...(args.excludeScheduleId ? { id: { not: args.excludeScheduleId } } : {}),
          scheduled_date: {
            gte: monthStart,
            lte: searchEnd,
          },
          schedule_status: { in: ACTIVE_BILLING_SCHEDULE_STATUSES },
        },
        select: {
          id: true,
          scheduled_date: true,
        },
        orderBy: [{ scheduled_date: 'asc' }],
      })) as Array<{ id: string; scheduled_date: Date }>
    ).map((schedule) => ({
      id: schedule.id,
      patient_id: args.patientId,
      scheduled_date: schedule.scheduled_date,
    }));
  const proposalRows =
    args.cadenceProposalRows?.filter(
      (row) =>
        row.patient_id === args.patientId &&
        row.proposed_date >= monthStart &&
        row.proposed_date <= searchEnd,
    ) ??
    (args.cadenceScheduleRows
      ? []
      : await loadBillingCadenceProposalRows({
          db,
          orgId: args.orgId,
          patientId: args.patientId,
          pharmacistId: args.pharmacistId,
          dateFrom: monthStart,
          dateTo: searchEnd,
        }));

  const monthCountByStart = new Map<number, number>();
  const weekCountByStart = new Map<number, number>();
  for (const schedule of schedules) {
    incrementCount(monthCountByStart, dateBucketKey(startOfBillingMonth(schedule.scheduled_date)));
    incrementCount(weekCountByStart, dateBucketKey(startOfBillingWeek(schedule.scheduled_date)));
  }
  const countedProposalMonthKeys = new Set<string>();
  const countedProposalWeekKeys = new Set<string>();
  for (const proposal of proposalRows) {
    if (
      !isCountableProposalRow(proposal, {
        excludeProposalId: args.excludeProposalId,
        excludeScheduleId: args.excludeScheduleId,
        excludeSupersededProposalScope: args.excludeSupersededProposalScope,
      })
    ) {
      continue;
    }
    const monthStartKey = dateBucketKey(startOfBillingMonth(proposal.proposed_date));
    const monthDedupeKey = proposal.proposal_batch_id
      ? `batch:${proposal.proposal_batch_id}:${monthStartKey}`
      : `proposal:${proposal.id}`;
    if (!countedProposalMonthKeys.has(monthDedupeKey)) {
      countedProposalMonthKeys.add(monthDedupeKey);
      incrementCount(monthCountByStart, monthStartKey);
    }

    const weekStartKey = dateBucketKey(startOfBillingWeek(proposal.proposed_date));
    const weekDedupeKey = proposal.proposal_batch_id
      ? `batch:${proposal.proposal_batch_id}:${weekStartKey}`
      : `proposal:${proposal.id}`;
    if (!countedProposalWeekKeys.has(weekDedupeKey)) {
      countedProposalWeekKeys.add(weekDedupeKey);
      incrementCount(weekCountByStart, weekStartKey);
    }
  }

  const scheduledDatesCurrentMonth = schedules
    .filter(
      (schedule) => schedule.scheduled_date >= monthStart && schedule.scheduled_date <= monthEnd,
    )
    .map((schedule) => formatUtcDateKey(schedule.scheduled_date));

  const currentMonthCount = monthCountByStart.get(dateBucketKey(monthStart)) ?? 0;
  const currentWeekStart = startOfBillingWeek(args.proposedDate);
  const currentWeekCount = weekCountByStart.get(dateBucketKey(currentWeekStart)) ?? 0;

  let nextBillableDate: Date | null = null;
  const suggestedDates: string[] = [];
  for (let offset = 0; offset <= NEXT_DATE_SEARCH_DAYS; offset += 1) {
    const candidate = addUtcDays(proposedBillingDay, offset);
    const candidateMonthStart = startOfBillingMonth(candidate);
    const monthCount = monthCountByStart.get(dateBucketKey(candidateMonthStart)) ?? 0;
    const candidateWeekCount =
      weeklyCap == null
        ? 0
        : (weekCountByStart.get(dateBucketKey(startOfBillingWeek(candidate))) ?? 0);

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
      : formatUtcDateKey(nextBillableDate) === formatUtcDateKey(proposedBillingDay)
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
  const db = (args.db ?? prisma) as BillingRequirementDb;
  const cadencePolicy = getBillingCadencePolicy();
  const asOf = new Date().toISOString();
  const alerts: BillingRequirementAlert[] = [];
  const monthStart = startOfBillingMonth(args.proposedDate);
  const monthEnd = endOfBillingMonth(args.proposedDate);
  const weekStart = startOfBillingWeek(args.proposedDate);
  const weekEnd = endOfBillingWeek(args.proposedDate);
  const cadenceProposalRows =
    args.cadenceProposalRows ??
    (args.cadenceScheduleRows
      ? Promise.resolve([])
      : loadBillingCadenceProposalRows({
          db,
          orgId: args.orgId,
          patientId: args.patientId,
          pharmacistId: args.pharmacistId,
          dateFrom: new Date(Math.min(monthStart.getTime(), weekStart.getTime())),
          dateTo: new Date(Math.max(monthEnd.getTime(), weekEnd.getTime())),
        }));

  // Parallel data fetches
  const [
    monthlyScheduleCount,
    weeklyPharmacistCount,
    weeklyPatientCount,
    existingRegularInMonth,
    proposalRows,
    consent,
    managementPlan,
  ] = await Promise.all([
    // Monthly schedule count for patient
    args.cadenceScheduleRows
      ? Promise.resolve(
          countScheduleRows(
            args.cadenceScheduleRows,
            (row) =>
              row.patient_id === args.patientId &&
              row.scheduled_date >= monthStart &&
              row.scheduled_date <= monthEnd,
            { excludeScheduleId: args.excludeScheduleId },
          ),
        )
      : db.visitSchedule.count({
          where: {
            org_id: args.orgId,
            case_: { patient_id: args.patientId },
            ...(args.excludeScheduleId ? { id: { not: args.excludeScheduleId } } : {}),
            scheduled_date: { gte: monthStart, lte: monthEnd },
            schedule_status: { in: ACTIVE_BILLING_SCHEDULE_STATUSES },
          },
        }),
    // Weekly visit count for pharmacist
    args.cadenceScheduleRows
      ? Promise.resolve(
          countScheduleRows(
            args.cadenceScheduleRows,
            (row) =>
              row.pharmacist_id === args.pharmacistId &&
              row.scheduled_date >= weekStart &&
              row.scheduled_date <= weekEnd,
            { excludeScheduleId: args.excludeScheduleId },
          ),
        )
      : db.visitSchedule.count({
          where: {
            org_id: args.orgId,
            pharmacist_id: args.pharmacistId,
            ...(args.excludeScheduleId ? { id: { not: args.excludeScheduleId } } : {}),
            scheduled_date: { gte: weekStart, lte: weekEnd },
            schedule_status: { in: ACTIVE_BILLING_SCHEDULE_STATUSES },
          },
        }),
    // Weekly visit count for patient (special cap check)
    args.specialCapEligible
      ? args.cadenceScheduleRows
        ? Promise.resolve(
            countScheduleRows(
              args.cadenceScheduleRows,
              (row) =>
                row.patient_id === args.patientId &&
                row.scheduled_date >= weekStart &&
                row.scheduled_date <= weekEnd,
              { excludeScheduleId: args.excludeScheduleId },
            ),
          )
        : db.visitSchedule.count({
            where: {
              org_id: args.orgId,
              case_: { patient_id: args.patientId },
              ...(args.excludeScheduleId ? { id: { not: args.excludeScheduleId } } : {}),
              scheduled_date: { gte: weekStart, lte: weekEnd },
              schedule_status: { in: ACTIVE_BILLING_SCHEDULE_STATUSES },
            },
          })
      : Promise.resolve(0),
    // Existing regular visits in month (for concurrent check)
    args.visitType === 'emergency'
      ? args.cadenceScheduleRows
        ? Promise.resolve(
            countScheduleRows(
              args.cadenceScheduleRows,
              (row) =>
                row.patient_id === args.patientId &&
                row.visit_type === 'regular' &&
                row.scheduled_date >= monthStart &&
                row.scheduled_date <= monthEnd,
              { excludeScheduleId: args.excludeScheduleId },
            ),
          )
        : db.visitSchedule.count({
            where: {
              org_id: args.orgId,
              case_: { patient_id: args.patientId },
              ...(args.excludeScheduleId ? { id: { not: args.excludeScheduleId } } : {}),
              visit_type: 'regular',
              scheduled_date: { gte: monthStart, lte: monthEnd },
              schedule_status: { in: ACTIVE_BILLING_SCHEDULE_STATUSES },
            },
          })
      : Promise.resolve(0),
    cadenceProposalRows,
    // Consent check
    args.workflowSnapshot
      ? Promise.resolve(
          args.workflowSnapshot.resolveConsent({
            patientId: args.patientId,
            asOf: args.proposedDate,
          }),
        )
      : findActiveVisitConsent(db, {
          orgId: args.orgId,
          patientId: args.patientId,
        }),
    // Management plan check
    args.workflowSnapshot
      ? Promise.resolve(
          args.workflowSnapshot.resolveManagementPlan({
            caseId: args.caseId,
            asOf: args.proposedDate,
          }),
        )
      : findCurrentManagementPlan(db, {
          orgId: args.orgId,
          caseId: args.caseId,
        }),
  ]);
  const monthlyProposalCount = countProposalRows(
    proposalRows,
    (row) =>
      row.patient_id === args.patientId &&
      row.proposed_date >= monthStart &&
      row.proposed_date <= monthEnd,
    (row) => `${row.patient_id}:${buildBillingMonthKey(row.proposed_date)}`,
    {
      excludeProposalId: args.excludeProposalId,
      excludeScheduleId: args.excludeScheduleId,
      excludeSupersededProposalScope: args.excludeSupersededProposalScope,
    },
  );
  const weeklyPharmacistProposalCount = countProposalRows(
    proposalRows,
    (row) =>
      row.proposed_pharmacist_id === args.pharmacistId &&
      row.proposed_date >= weekStart &&
      row.proposed_date <= weekEnd,
    (row) => `${row.proposed_pharmacist_id ?? ''}:${buildBillingWeekKey(row.proposed_date)}`,
    {
      excludeProposalId: args.excludeProposalId,
      excludeScheduleId: args.excludeScheduleId,
      excludeSupersededProposalScope: args.excludeSupersededProposalScope,
    },
  );
  const weeklyPatientProposalCount = args.specialCapEligible
    ? countProposalRows(
        proposalRows,
        (row) =>
          row.patient_id === args.patientId &&
          row.proposed_date >= weekStart &&
          row.proposed_date <= weekEnd,
        (row) => `${row.patient_id}:${buildBillingWeekKey(row.proposed_date)}`,
        {
          excludeProposalId: args.excludeProposalId,
          excludeScheduleId: args.excludeScheduleId,
          excludeSupersededProposalScope: args.excludeSupersededProposalScope,
        },
      )
    : 0;
  const existingRegularProposalInMonth =
    args.visitType === 'emergency'
      ? countProposalRows(
          proposalRows,
          (row) =>
            row.patient_id === args.patientId &&
            row.visit_type === 'regular' &&
            row.proposed_date >= monthStart &&
            row.proposed_date <= monthEnd,
          (row) => `${row.patient_id}:regular:${buildBillingMonthKey(row.proposed_date)}`,
          {
            excludeProposalId: args.excludeProposalId,
            excludeScheduleId: args.excludeScheduleId,
            excludeSupersededProposalScope: args.excludeSupersededProposalScope,
          },
        )
      : 0;
  const monthlyVisitCount = monthlyScheduleCount + monthlyProposalCount;
  const weeklyPharmacistVisitCount = weeklyPharmacistCount + weeklyPharmacistProposalCount;
  const weeklyPatientVisitCount = weeklyPatientCount + weeklyPatientProposalCount;
  const existingRegularVisitInMonth = existingRegularInMonth + existingRegularProposalInMonth;

  const pharmacist =
    args.pharmacistWeeklyCap === undefined
      ? await db.user.findFirst({
          where: { id: args.pharmacistId, org_id: args.orgId },
          select: { max_weekly_visits: true },
        })
      : null;

  const pharmacistWeeklyCap =
    args.pharmacistWeeklyCap ??
    pharmacist?.max_weekly_visits ??
    cadencePolicy.weeklyPharmacistCapDefault;

  // ── Alert #1: Monthly cap exceeded ──
  const monthlyCap = args.specialCapEligible
    ? cadencePolicy.monthlyCapSpecial
    : cadencePolicy.monthlyCapDefault;
  const projectedMonthly = monthlyVisitCount + 1; // +1 for new proposal

  if (projectedMonthly > monthlyCap) {
    alerts.push({
      type: 'monthly_cap_exceeded',
      severity: 'error',
      message: `この患者は今月既に${monthlyVisitCount}回の訪問が予定されています。月上限${monthlyCap}回を超過します`,
      details: {
        current_count: monthlyVisitCount,
        projected_count: projectedMonthly,
        cap: monthlyCap,
        special_cap_eligible: args.specialCapEligible ?? false,
      },
      as_of: asOf,
    });
  }

  // ── Alert #2: Pharmacist weekly capacity ──
  const projectedWeeklyPharmacist = weeklyPharmacistVisitCount + 1;
  const capacityRatio = projectedWeeklyPharmacist / pharmacistWeeklyCap;

  if (capacityRatio >= PHARMACIST_CAP_THRESHOLD) {
    alerts.push({
      type: 'pharmacist_weekly_capacity',
      severity: 'warning',
      message: `この薬剤師は今週${weeklyPharmacistVisitCount}件の訪問が予定されています。週上限${pharmacistWeeklyCap}件の${Math.round(capacityRatio * 100)}%です`,
      details: {
        current_count: weeklyPharmacistVisitCount,
        projected_count: projectedWeeklyPharmacist,
        cap: pharmacistWeeklyCap,
        ratio: capacityRatio,
      },
      as_of: asOf,
    });
  }

  // ── Alert #3: Emergency/regular concurrent billing ──
  if (args.visitType === 'emergency' && existingRegularVisitInMonth > 0) {
    alerts.push({
      type: 'emergency_regular_concurrent',
      severity: 'warning',
      message: `この患者は今月${existingRegularVisitInMonth}回の定期訪問が予定されています。緊急訪問指導料との並算定制限にご注意ください`,
      details: {
        regular_count: existingRegularVisitInMonth,
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
    const projectedWeeklyPatient = weeklyPatientVisitCount + 1;

    if (projectedWeeklyPatient > cadencePolicy.specialWeeklyCap) {
      alerts.push({
        type: 'special_patient_weekly_cap',
        severity: 'warning',
        message: `特別対象患者です。今週既に${weeklyPatientVisitCount}回の訪問が予定されています（週上限${cadencePolicy.specialWeeklyCap}回）`,
        details: {
          current_count: weeklyPatientVisitCount,
          projected_count: projectedWeeklyPatient,
          cap: cadencePolicy.specialWeeklyCap,
        },
        as_of: asOf,
      });
    }
  }

  return alerts;
}
