import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { formatUtcDateKey } from '@/lib/date-key';
import { prisma } from '@/lib/db/client';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import type {
  DayBoardPendingProposal,
  DayBoardStaff,
  DayBoardVisit,
  DayBoardVisitPreparationSummary,
  DayBoardVisitReadyBlockerSummary,
  ScheduleDayBoardResponse,
} from '@/types/schedule-day-board';
import { describeBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import {
  VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER,
  buildVisitReadyOnboardingBlockers,
  buildVisitReadyReadinessBlockers,
  isVisitReadyPrimaryPhysicianRole,
  isVisitCarryItemsStatusBlockingReady,
  type VisitReadyOnboardingReadiness,
} from '@/server/services/visit-preparation-readiness';

/**
 * new_03_schedule(今日のスケジュール — 全員)用 BFF。
 * 薬剤師・事務の担当者レーン(当日訪問+タスク件数)と未確定(受入判断)を
 * 1 リクエストで返す読み取り専用集計(docs/design-gap-analysis-new.md 03_schedule)。
 * 右レール(次にやること/止まっている理由)は /api/dashboard/cockpit を共用する。
 */

const STAFF_ROW_LIMIT = 6;
const PENDING_PROPOSAL_LIMIT = 3;
/** 余白試算: 勤務帯 9:00-18:00 から昼休みを除いた基準分 */
const WORKDAY_MINUTES = 9 * 60;
const LUNCH_MINUTES = 60;
const TRAVEL_MINUTES_PER_VISIT = 30;
const DEFAULT_VISIT_MINUTES = 60;

const BOARD_MEMBER_ROLES = ['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk'] as const;
const VEHICLE_ASSIGNABLE_STATUSES = new Set([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);
const PREPARATION_SUMMARY_ITEMS = [
  ['medication_changes_reviewed', '薬歴・前回変更の確認'],
  ['carry_items_confirmed', '持参薬・物品確認'],
  ['previous_issues_reviewed', '前回課題の確認'],
  ['route_confirmed', 'ルート確認'],
  ['offline_synced', 'オフライン同期確認'],
] as const;

type DayBoardScheduleReadySource = {
  id: string;
  case_id: string;
  cycle_id: string | null;
  carry_items_status: string | null;
  scheduled_date: Date;
  preparation: {
    org_id: string;
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
  } | null;
  visit_record: { id: string } | null;
  case_: {
    patient: {
      id: string;
      contacts: Array<{ id: string }>;
    };
    care_team_links: Array<{ role: string }>;
  };
};

type DayBoardManagementPlan = {
  case_id: string;
  next_review_date: Date | null;
  effective_from: Date | null;
  version: number;
  approved_at: Date | null;
};

const dayBoardQuerySchema = z.object({
  date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
});

// 日付キー生成・@db.Date 比較は date-boundary ヘルパーに統一(JST 当日取りこぼし防止)

function isStringId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function scheduleReadyAsOf(schedule: Pick<DayBoardScheduleReadySource, 'scheduled_date'>) {
  return schedule.scheduled_date instanceof Date ? schedule.scheduled_date : new Date(0);
}

function minutesOfTimeValue(value: Date | null): number | null {
  if (!value) return null;
  return value.getHours() * 60 + value.getMinutes();
}

/** 訪問の占有分(時間未設定は既定 60 分)。 */
function visitOccupiedMinutes(start: Date | null, end: Date | null): number {
  const startMinutes = minutesOfTimeValue(start);
  const endMinutes = minutesOfTimeValue(end);
  if (startMinutes == null) return DEFAULT_VISIT_MINUTES;
  if (endMinutes == null || endMinutes <= startMinutes) return DEFAULT_VISIT_MINUTES;
  return endMinutes - startMinutes;
}

function activeThrough(date: Date | null | undefined, asOf: Date) {
  return !date || date >= asOf;
}

function compareManagementPlans(left: DayBoardManagementPlan, right: DayBoardManagementPlan) {
  const effectiveDiff =
    (right.effective_from?.getTime() ?? 0) - (left.effective_from?.getTime() ?? 0);
  if (effectiveDiff !== 0) return effectiveDiff;

  const versionDiff = (right.version ?? 0) - (left.version ?? 0);
  if (versionDiff !== 0) return versionDiff;

  return (right.approved_at?.getTime() ?? 0) - (left.approved_at?.getTime() ?? 0);
}

function buildReadyBlockerSummary(args: {
  preparationBlockerCount: number;
  onboardingBlockerCount: number;
  billingBlockerCount: number;
}): DayBoardVisitReadyBlockerSummary {
  const categoryLabels = [
    args.preparationBlockerCount > 0 ? `訪問前提 ${args.preparationBlockerCount}件` : null,
    args.onboardingBlockerCount > 0 ? `導入準備 ${args.onboardingBlockerCount}件` : null,
    args.billingBlockerCount > 0 ? `算定確認 ${args.billingBlockerCount}件` : null,
  ].filter((label): label is string => label !== null);
  const blockerCount =
    args.preparationBlockerCount + args.onboardingBlockerCount + args.billingBlockerCount;

  return {
    blocked: blockerCount > 0,
    blocker_count: blockerCount,
    category_labels: categoryLabels,
    preparation_blocker_count: args.preparationBlockerCount,
    onboarding_blocker_count: args.onboardingBlockerCount,
    billing_blocker_count: args.billingBlockerCount,
  };
}

async function buildReadyBlockerSummaries(
  orgId: string,
  schedules: DayBoardScheduleReadySource[],
): Promise<Map<string, DayBoardVisitReadyBlockerSummary>> {
  const summaries = new Map<string, DayBoardVisitReadyBlockerSummary>();
  if (schedules.length === 0) return summaries;

  const patientIds = Array.from(
    new Set(schedules.map((schedule) => schedule.case_.patient.id).filter(isStringId)),
  );
  const caseIds = Array.from(
    new Set(schedules.map((schedule) => schedule.case_id).filter(isStringId)),
  );
  const visitRecordIds = schedules.flatMap((schedule) =>
    schedule.visit_record?.id ? [schedule.visit_record.id] : [],
  );
  const cycleIds = schedules.flatMap((schedule) => (schedule.cycle_id ? [schedule.cycle_id] : []));
  const minScheduledDate = new Date(
    Math.min(...schedules.map((schedule) => scheduleReadyAsOf(schedule).getTime())),
  );
  const maxScheduledDate = new Date(
    Math.max(...schedules.map((schedule) => scheduleReadyAsOf(schedule).getTime())),
  );

  const [consents, firstVisitDocuments, managementPlans, billingEvidence] = await Promise.all([
    patientIds.length === 0
      ? Promise.resolve([])
      : prisma.consentRecord.findMany({
          where: {
            org_id: orgId,
            patient_id: { in: patientIds },
            consent_type: 'visit_medication_management',
            is_active: true,
            revoked_date: null,
            OR: [{ expiry_date: null }, { expiry_date: { gte: minScheduledDate } }],
          },
          select: { patient_id: true },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.firstVisitDocument.findMany({
          where: { org_id: orgId, case_id: { in: caseIds } },
          orderBy: [{ case_id: 'asc' }, { created_at: 'desc' }],
          select: { case_id: true, delivered_at: true, created_at: true },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : prisma.managementPlan.findMany({
          where: {
            org_id: orgId,
            case_id: { in: caseIds },
            status: 'approved',
            approved_at: { not: null },
            OR: [{ effective_from: null }, { effective_from: { lte: maxScheduledDate } }],
          },
          orderBy: [{ case_id: 'asc' }, { effective_from: 'desc' }, { version: 'desc' }],
          select: {
            case_id: true,
            next_review_date: true,
            effective_from: true,
            version: true,
            approved_at: true,
          },
        }),
    visitRecordIds.length === 0 && cycleIds.length === 0
      ? Promise.resolve([])
      : prisma.billingEvidence.findMany({
          where: {
            org_id: orgId,
            claimable: false,
            OR: [
              ...(visitRecordIds.length > 0 ? [{ visit_record_id: { in: visitRecordIds } }] : []),
              ...(cycleIds.length > 0 ? [{ cycle_id: { in: cycleIds } }] : []),
            ],
          },
          orderBy: [{ billing_month: 'desc' }, { updated_at: 'desc' }],
          select: {
            id: true,
            visit_record_id: true,
            cycle_id: true,
            claimable: true,
            exclusion_reason: true,
            same_month_exclusion_flags: true,
          },
        }),
  ]);

  const consentPatientIds = new Set(consents.map((consent) => consent.patient_id));
  const firstVisitDocumentByCaseId = new Map<string, (typeof firstVisitDocuments)[number]>();
  for (const document of firstVisitDocuments) {
    if (!firstVisitDocumentByCaseId.has(document.case_id)) {
      firstVisitDocumentByCaseId.set(document.case_id, document);
    }
  }

  const managementPlansByCaseId = new Map<string, DayBoardManagementPlan[]>();
  for (const plan of managementPlans) {
    const list = managementPlansByCaseId.get(plan.case_id) ?? [];
    list.push(plan);
    managementPlansByCaseId.set(plan.case_id, list);
  }
  for (const [caseId, plans] of managementPlansByCaseId) {
    managementPlansByCaseId.set(caseId, plans.sort(compareManagementPlans));
  }

  const billingEvidenceByVisitRecordId = new Map<string, typeof billingEvidence>();
  const billingEvidenceByCycleId = new Map<string, typeof billingEvidence>();
  for (const evidence of billingEvidence) {
    const visitRecordList = billingEvidenceByVisitRecordId.get(evidence.visit_record_id) ?? [];
    visitRecordList.push(evidence);
    billingEvidenceByVisitRecordId.set(evidence.visit_record_id, visitRecordList);
    if (evidence.cycle_id) {
      const cycleList = billingEvidenceByCycleId.get(evidence.cycle_id) ?? [];
      cycleList.push(evidence);
      billingEvidenceByCycleId.set(evidence.cycle_id, cycleList);
    }
  }

  for (const schedule of schedules) {
    const preparationBlockerCount = buildVisitReadyReadinessBlockers(
      schedule.preparation,
      schedule.carry_items_status,
    ).length;
    const currentPlan =
      managementPlansByCaseId
        .get(schedule.case_id)
        ?.find(
          (plan) =>
            plan.effective_from == null || plan.effective_from <= scheduleReadyAsOf(schedule),
        ) ?? null;
    const onboardingReadiness = {
      consent_obtained: consentPatientIds.has(schedule.case_.patient.id),
      emergency_contact_set: (schedule.case_.patient.contacts ?? []).length > 0,
      first_visit_doc_delivered:
        firstVisitDocumentByCaseId.get(schedule.case_id)?.delivered_at != null,
      management_plan_approved:
        currentPlan != null &&
        activeThrough(currentPlan.next_review_date, scheduleReadyAsOf(schedule)),
      primary_physician_set: (schedule.case_.care_team_links ?? []).some((link) =>
        isVisitReadyPrimaryPhysicianRole(link.role),
      ),
    } satisfies VisitReadyOnboardingReadiness;
    const onboardingBlockerCount = buildVisitReadyOnboardingBlockers(onboardingReadiness).length;

    const evidenceById = new Map<string, (typeof billingEvidence)[number]>();
    for (const evidence of schedule.visit_record?.id
      ? (billingEvidenceByVisitRecordId.get(schedule.visit_record.id) ?? [])
      : []) {
      evidenceById.set(evidence.id, evidence);
    }
    for (const evidence of schedule.cycle_id
      ? (billingEvidenceByCycleId.get(schedule.cycle_id) ?? [])
      : []) {
      evidenceById.set(evidence.id, evidence);
    }
    const billingBlockerCount = Array.from(evidenceById.values()).reduce(
      (total, evidence) =>
        total +
        describeBillingEvidenceBlockers({
          claimable: evidence.claimable,
          exclusionReason: evidence.exclusion_reason,
          sameMonthExclusionFlags: evidence.same_month_exclusion_flags,
        }).length,
      0,
    );

    summaries.set(
      schedule.id,
      buildReadyBlockerSummary({
        preparationBlockerCount,
        onboardingBlockerCount,
        billingBlockerCount,
      }),
    );
  }

  return summaries;
}

function buildPreparationSummary(schedule: {
  carry_items_status: string | null;
  ready_blocker_summary?: DayBoardVisitReadyBlockerSummary;
  preparation: {
    prepared_at: Date | null;
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
  } | null;
}): DayBoardVisitPreparationSummary {
  if (!schedule.preparation) {
    return {
      completed_count: 0,
      total_count: PREPARATION_SUMMARY_ITEMS.length,
      status: 'unknown',
      incomplete_labels: ['準備未確認'],
      ready_blocker_summary: schedule.ready_blocker_summary,
    };
  }

  const completedCount = PREPARATION_SUMMARY_ITEMS.filter(
    ([field]) => schedule.preparation?.[field] === true,
  ).length;
  const incompleteLabels: string[] = PREPARATION_SUMMARY_ITEMS.flatMap(([field, label]) =>
    schedule.preparation?.[field] === true ? [] : [label],
  );
  const carryItemsBlocked = isVisitCarryItemsStatusBlockingReady(schedule.carry_items_status);
  if (carryItemsBlocked) incompleteLabels.unshift(VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER);
  if (completedCount === PREPARATION_SUMMARY_ITEMS.length && !schedule.preparation?.prepared_at) {
    incompleteLabels.unshift('準備完了時刻未確定');
  }

  return {
    completed_count: completedCount,
    total_count: PREPARATION_SUMMARY_ITEMS.length,
    status: incompleteLabels.length === 0 ? 'ready' : carryItemsBlocked ? 'blocked' : 'incomplete',
    incomplete_labels: incompleteLabels,
    ready_blocker_summary: schedule.ready_blocker_summary,
  };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = parseSearchParams(dayBoardQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    // scheduled_date(@db.Date)は UTC midnight 保存。ローカル解釈の Date を渡すと
    // Prisma が UTC 日付へ切り捨てて前日扱いになる(JST で当日全件こぼれる)ため、
    // ローカル日付キー → UTC midnight に正規化して比較する。
    const dateKey = parsed.data.date ?? localDateKey(now);
    const dayStart = utcDateFromLocalKey(dateKey);
    const dayEnd = addUtcDays(dayStart, 1);

    const [
      memberships,
      schedules,
      auditTaskGroups,
      openTaskGroups,
      reportPendingCount,
      unavailableShifts,
      vehicleResources,
      proposals,
    ] = await Promise.all([
      prisma.membership.findMany({
        where: {
          org_id: ctx.orgId,
          is_active: true,
          role: { in: [...BOARD_MEMBER_ROLES] },
        },
        orderBy: [{ user: { name_kana: 'asc' } }],
        select: {
          role: true,
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.visitSchedule.findMany({
        where: {
          org_id: ctx.orgId,
          scheduled_date: { gte: dayStart, lt: dayEnd },
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
        orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
        select: {
          id: true,
          case_id: true,
          cycle_id: true,
          pharmacist_id: true,
          visit_type: true,
          schedule_status: true,
          scheduled_date: true,
          carry_items_status: true,
          priority: true,
          site_id: true,
          route_order: true,
          vehicle_resource_id: true,
          vehicle_resource: {
            select: {
              id: true,
              label: true,
              travel_mode: true,
            },
          },
          time_window_start: true,
          time_window_end: true,
          confirmed_at: true,
          preparation: {
            select: {
              org_id: true,
              prepared_at: true,
              medication_changes_reviewed: true,
              carry_items_confirmed: true,
              previous_issues_reviewed: true,
              route_confirmed: true,
              offline_synced: true,
            },
          },
          facility_batch_id: true,
          facility_batch: { select: { id: true, facility_id: true } },
          visit_record: { select: { id: true } },
          case_: {
            select: {
              patient: {
                select: {
                  id: true,
                  name: true,
                  contacts: {
                    where: { org_id: ctx.orgId, is_emergency_contact: true },
                    select: { id: true },
                  },
                },
              },
              care_team_links: {
                where: { org_id: ctx.orgId },
                select: { role: true },
              },
            },
          },
        },
      }),
      prisma.dispenseTask.groupBy({
        by: ['assigned_to'],
        where: { org_id: ctx.orgId, status: 'completed' },
        _count: { id: true },
      }),
      prisma.task.groupBy({
        by: ['assigned_to'],
        where: { org_id: ctx.orgId, status: { in: ['pending', 'in_progress'] } },
        _count: { id: true },
      }),
      prisma.medicationCycle.count({
        where: { org_id: ctx.orgId, overall_status: 'visit_completed' },
      }),
      prisma.pharmacistShift.findMany({
        where: {
          org_id: ctx.orgId,
          date: { gte: dayStart, lt: dayEnd },
          available: false,
        },
        select: { user_id: true },
      }),
      prisma.visitVehicleResource.findMany({
        where: {
          org_id: ctx.orgId,
        },
        orderBy: [{ available: 'desc' }, { label: 'asc' }],
        select: {
          id: true,
          label: true,
          site_id: true,
          vehicle_code: true,
          travel_mode: true,
          max_stops: true,
          available: true,
        },
      }),
      prisma.visitScheduleProposal.findMany({
        where: {
          org_id: ctx.orgId,
          proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
          proposed_date: { gte: dayStart },
        },
        orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }],
        take: PENDING_PROPOSAL_LIMIT,
        select: {
          id: true,
          visit_type: true,
          proposal_status: true,
          proposed_date: true,
          time_window_start: true,
          time_window_end: true,
          proposed_pharmacist_id: true,
          case_: { select: { patient: { select: { name: true } } } },
        },
      }),
    ]);

    // 施設名(facility_batch.facility_id → Facility.name)
    const facilityIds = Array.from(
      new Set(
        schedules
          .map((schedule) => schedule.facility_batch?.facility_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const facilities =
      facilityIds.length === 0
        ? []
        : await prisma.facility.findMany({
            where: { org_id: ctx.orgId, id: { in: facilityIds } },
            select: { id: true, name: true },
          });
    const facilityNameById = new Map(facilities.map((facility) => [facility.id, facility.name]));
    const batchPatientCounts = new Map<string, number>();
    for (const schedule of schedules) {
      if (!schedule.facility_batch_id) continue;
      batchPatientCounts.set(
        schedule.facility_batch_id,
        (batchPatientCounts.get(schedule.facility_batch_id) ?? 0) + 1,
      );
    }

    const auditCountByUser = new Map(
      auditTaskGroups
        .filter((group) => group.assigned_to)
        .map((group) => [group.assigned_to as string, group._count.id]),
    );
    const unassignedAuditCount =
      auditTaskGroups.find((group) => group.assigned_to == null)?._count.id ?? 0;
    const openTaskCountByUser = new Map(
      openTaskGroups
        .filter((group) => group.assigned_to)
        .map((group) => [group.assigned_to as string, group._count.id]),
    );

    const schedulesByPharmacist = new Map<string, typeof schedules>();
    for (const schedule of schedules) {
      const list = schedulesByPharmacist.get(schedule.pharmacist_id) ?? [];
      list.push(schedule);
      schedulesByPharmacist.set(schedule.pharmacist_id, list);
    }
    const readyBlockerSummaryByScheduleId = await buildReadyBlockerSummaries(ctx.orgId, schedules);

    const toBoardVisit = (schedule: (typeof schedules)[number]): DayBoardVisit => ({
      id: schedule.id,
      patient_name: schedule.case_.patient.name,
      visit_type: schedule.visit_type,
      schedule_status: schedule.schedule_status,
      priority: schedule.priority,
      site_id: schedule.site_id,
      route_order: schedule.route_order,
      time_start: schedule.time_window_start?.toISOString() ?? null,
      time_end: schedule.time_window_end?.toISOString() ?? null,
      vehicle_resource_id: schedule.vehicle_resource_id,
      vehicle_label: schedule.vehicle_resource?.label ?? null,
      vehicle_travel_mode: schedule.vehicle_resource?.travel_mode ?? null,
      confirmed: schedule.confirmed_at != null,
      facility_label: schedule.facility_batch
        ? (facilityNameById.get(schedule.facility_batch.facility_id) ?? '施設')
        : null,
      facility_batch_id: schedule.facility_batch_id,
      facility_patient_count: schedule.facility_batch_id
        ? (batchPatientCounts.get(schedule.facility_batch_id) ?? 1)
        : 1,
      preparation_summary: buildPreparationSummary({
        ...schedule,
        ready_blocker_summary: readyBlockerSummaryByScheduleId.get(schedule.id),
      }),
    });

    // 同一ユーザーの重複 membership を除去しつつ、訪問のある担当者を優先して行数を絞る。
    // 当日シフトで不在(available=false)のメンバーはボードに出さない(デザイン 03: 休みはレーン非表示)
    const unavailableUserIds = new Set(unavailableShifts.map((shift) => shift.user_id));
    const seenUserIds = new Set<string>();
    const staffAll: DayBoardStaff[] = [];
    for (const membership of memberships) {
      if (seenUserIds.has(membership.user.id)) continue;
      if (unavailableUserIds.has(membership.user.id)) continue;
      seenUserIds.add(membership.user.id);
      staffAll.push({
        id: membership.user.id,
        name: membership.user.name,
        role: membership.role,
        role_kind: membership.role === 'clerk' ? 'clerk' : 'pharmacist',
        visits: (schedulesByPharmacist.get(membership.user.id) ?? []).map(toBoardVisit),
        open_task_count: openTaskCountByUser.get(membership.user.id) ?? 0,
        audit_task_count: auditCountByUser.get(membership.user.id) ?? 0,
      });
    }
    const staff = [...staffAll]
      .sort((left, right) => {
        if (left.role_kind !== right.role_kind) return left.role_kind === 'pharmacist' ? -1 : 1;
        if (left.visits.length !== right.visits.length) {
          return right.visits.length - left.visits.length;
        }
        return left.name.localeCompare(right.name, 'ja');
      })
      .slice(0, STAFF_ROW_LIMIT);

    // 担当未割当の監査待ちは先頭の薬剤師行に仮配分(デスク作業ブロックの仮置き)
    const firstPharmacist = staff.find((member) => member.role_kind === 'pharmacist');
    if (firstPharmacist && unassignedAuditCount > 0) {
      firstPharmacist.audit_task_count += unassignedAuditCount;
    }

    // 未確定候補: 確定した場合の担当余白(分)の変化を試算
    const pharmacistNameById = new Map(staffAll.map((member) => [member.id, member.name]));
    // proposed_date(@db.Date)は UTC midnight 保存なのでそのまま範囲端に使う
    const proposalImpactPairs = proposals.map((proposal) => ({
      pharmacistId: proposal.proposed_pharmacist_id,
      dayStart: proposal.proposed_date,
    }));
    const impactSchedules =
      proposalImpactPairs.length === 0
        ? []
        : await prisma.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              schedule_status: { notIn: ['cancelled', 'rescheduled'] },
              OR: proposalImpactPairs.map((pair) => ({
                pharmacist_id: pair.pharmacistId,
                scheduled_date: { gte: pair.dayStart, lt: addUtcDays(pair.dayStart, 1) },
              })),
            },
            select: {
              pharmacist_id: true,
              scheduled_date: true,
              time_window_start: true,
              time_window_end: true,
            },
          });

    const proposalIds = proposals.map((proposal) => proposal.id);
    const proposalContactLogs =
      proposalIds.length === 0
        ? []
        : await prisma.visitScheduleContactLog.findMany({
            where: { org_id: ctx.orgId, proposal_id: { in: proposalIds } },
            orderBy: [{ proposal_id: 'asc' }, { called_at: 'desc' }],
            select: { proposal_id: true, callback_due_at: true },
          });
    const latestContactLogByProposalId = new Map<string, (typeof proposalContactLogs)[number]>();
    for (const contactLog of proposalContactLogs) {
      if (contactLog.proposal_id && !latestContactLogByProposalId.has(contactLog.proposal_id)) {
        latestContactLogByProposalId.set(contactLog.proposal_id, contactLog);
      }
    }

    const pendingProposals: DayBoardPendingProposal[] = proposals.map((proposal) => {
      const proposedDateTime = proposal.proposed_date.getTime();
      // @db.Date is stored at UTC midnight, so use the canonical UTC date key.
      const proposedDateKey = formatUtcDateKey(proposal.proposed_date);
      const sameDayVisits = impactSchedules.filter(
        (schedule) =>
          schedule.pharmacist_id === proposal.proposed_pharmacist_id &&
          schedule.scheduled_date.getTime() === proposedDateTime,
      );
      const occupied = sameDayVisits.reduce(
        (sum, schedule) =>
          sum +
          visitOccupiedMinutes(schedule.time_window_start, schedule.time_window_end) +
          TRAVEL_MINUTES_PER_VISIT,
        0,
      );
      const idleBefore = Math.max(0, WORKDAY_MINUTES - LUNCH_MINUTES - occupied);
      const proposalMinutes =
        visitOccupiedMinutes(proposal.time_window_start, proposal.time_window_end) +
        TRAVEL_MINUTES_PER_VISIT;
      const idleAfter = Math.max(0, idleBefore - proposalMinutes);

      const latestContactLog = latestContactLogByProposalId.get(proposal.id);

      return {
        id: proposal.id,
        patient_name: proposal.case_.patient.name,
        pharmacist_name: pharmacistNameById.get(proposal.proposed_pharmacist_id) ?? null,
        proposed_date: proposedDateKey,
        time_start: proposal.time_window_start?.toISOString() ?? null,
        badge_label:
          proposal.proposal_status === 'reschedule_pending'
            ? '再調整'
            : proposal.visit_type === 'initial'
              ? '受入判断'
              : '確定待ち',
        response_due_at: latestContactLog?.callback_due_at?.toISOString() ?? null,
        idle_before_minutes: idleBefore,
        idle_after_minutes: idleAfter,
      } satisfies DayBoardPendingProposal;
    });

    const auditPendingCount = auditTaskGroups.reduce((sum, group) => sum + group._count.id, 0);
    const assignedVehicleCounts = new Map<string, number>();
    const unassignedAssignableVisitCountsBySite = new Map<string, number>();
    for (const schedule of schedules) {
      if (schedule.vehicle_resource_id) {
        assignedVehicleCounts.set(
          schedule.vehicle_resource_id,
          (assignedVehicleCounts.get(schedule.vehicle_resource_id) ?? 0) + 1,
        );
      } else if (VEHICLE_ASSIGNABLE_STATUSES.has(schedule.schedule_status)) {
        const siteKey = schedule.site_id ?? '';
        unassignedAssignableVisitCountsBySite.set(
          siteKey,
          (unassignedAssignableVisitCountsBySite.get(siteKey) ?? 0) + 1,
        );
      }
    }
    const vehicleSummaries = vehicleResources.map((vehicle) => {
      const assignedVisitCount = assignedVehicleCounts.get(vehicle.id) ?? 0;
      const remainingStops = Math.max(0, vehicle.max_stops - assignedVisitCount);
      const matchingUnassignedVisitCount =
        unassignedAssignableVisitCountsBySite.get(vehicle.site_id ?? '') ?? 0;
      return {
        id: vehicle.id,
        label: vehicle.label,
        site_id: vehicle.site_id,
        vehicle_code: vehicle.vehicle_code,
        travel_mode: vehicle.travel_mode,
        available: vehicle.available,
        max_stops: vehicle.max_stops,
        assigned_visit_count: assignedVisitCount,
        remaining_stops: remainingStops,
        matching_unassigned_visit_count: matchingUnassignedVisitCount,
        recommended: false,
        recommendation_reason: vehicle.available
          ? remainingStops > 0
            ? `空き ${remainingStops}件`
            : '本日の上限に到達'
          : '停止中',
      };
    });
    const recommendedVehicle = vehicleSummaries
      .filter((vehicle) => vehicle.available && vehicle.remaining_stops > 0)
      .sort(
        (left, right) =>
          Math.min(right.remaining_stops, right.matching_unassigned_visit_count) -
            Math.min(left.remaining_stops, left.matching_unassigned_visit_count) ||
          right.remaining_stops - left.remaining_stops ||
          left.assigned_visit_count - right.assigned_visit_count ||
          left.label.localeCompare(right.label, 'ja'),
      )[0];
    if (recommendedVehicle) {
      recommendedVehicle.recommended = true;
      recommendedVehicle.recommendation_reason =
        recommendedVehicle.matching_unassigned_visit_count > 0
          ? `同一拠点の未割当 ${Math.min(
              recommendedVehicle.remaining_stops,
              recommendedVehicle.matching_unassigned_visit_count,
            )}件を受けられます`
          : `予備枠 ${recommendedVehicle.remaining_stops}件`;
    }

    const responseData: ScheduleDayBoardResponse = {
      generated_at: now.toISOString(),
      date: dateKey,
      staff,
      audit_pending_count: auditPendingCount,
      report_pending_count: reportPendingCount,
      vehicle_resources: vehicleSummaries,
      pending_proposals: pendingProposals,
    };

    return success({ data: responseData });
  },
  {
    permission: 'canVisit',
    message: '訪問予定の閲覧権限がありません',
  },
);
