import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseSearchParams } from '@/lib/api/validation';
import { formatUtcDateKey } from '@/lib/date-key';
import { buildPatientOperationalSummarySelect } from '@/lib/db/patient-operational-summary-select';
import { withOrgContext } from '@/lib/db/rls';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { addUtcDays, japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { timeDateToMinutes } from '@/lib/visits/time-of-day';
import { OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES } from '@/lib/visit-schedule-proposals/route-order';
import { createRoadTravelEstimator } from '@/server/services/road-routing';
import { buildVehicleRoutePoint } from '@/server/services/visit-schedule-service';
import { attachVisitSchedulePatientSummary } from '@/server/services/visit-schedule-patient-summary';
import {
  estimateVehicleRouteDurationWithCandidate,
  type VehicleRouteDurationPoint,
} from '@/server/services/visit-schedule-planner';
import type {
  DayBoardVehicleResource,
  DayBoardPendingProposal,
  DayBoardStaff,
  DayBoardVisit,
  DayBoardVisitPreparationSummary,
  DayBoardVisitReadyBlockerSummary,
  ScheduleDayBoardOperationalTask,
  ScheduleDayBoardResponse,
} from '@/types/schedule-day-board';
import type { VisitRouteTravelMode } from '@/types/visit-route';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import { describeBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import {
  VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER,
  VISIT_READY_PREPARATION_ITEMS,
  buildVisitReadyOnboardingBlockers,
  buildVisitReadyReadinessBlockers,
  isVisitReadyPrimaryPhysicianRole,
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
const OPERATIONAL_TASK_LIMIT = 24;
/** 余白試算: シフト未登録時は 9:00-18:00 とみなす */
const DEFAULT_WORKDAY_START_MINUTES = 9 * 60;
const DEFAULT_WORKDAY_END_MINUTES = 18 * 60;
const LUNCH_START_MINUTES = 12 * 60;
const LUNCH_END_MINUTES = 13 * 60;
const TRAVEL_MINUTES_PER_VISIT = 30;
const DEFAULT_VISIT_MINUTES = 60;

const BOARD_MEMBER_ROLES = ['owner', 'admin', 'pharmacist', 'pharmacist_trainee', 'clerk'] as const;
const SCHEDULE_BOARD_TASK_TYPES = [
  'visit_preparation',
  'visit_contact_followup',
  'visit_schedule_reproposal_needed',
  'visit_schedule_override_approval',
  'visit_carry_item_review',
  'facility_batch_tracker',
  'mobile_visit_mode',
  'pharmacy.inbound_schedule_request_review_required',
] as const;
const OPEN_OPERATIONAL_TASK_STATUSES = ['pending', 'in_progress'] as const;
const VEHICLE_ASSIGNABLE_STATUSES = new Set([
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
]);
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
      archived_at?: Date | null;
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

type DayBoardVehicleRouteSchedule = {
  scheduled_date: Date;
  route_order: number | null;
  time_window_start: Date | null;
  case_: {
    patient: {
      residences?: Array<{ address: string | null; lat: number | null; lng: number | null }>;
    };
  };
};

type DayBoardVehicleRouteSource = {
  label: string;
  travel_mode: string;
  max_route_duration_minutes?: number | null;
  site?: { address: string | null; lat: number | null; lng: number | null } | null;
};

type DayBoardVehicleSummary = DayBoardVehicleResource & {
  matching_unassigned_visit_count: number;
};

type DayBoardDb = Pick<
  Prisma.TransactionClient,
  | 'billingEvidence'
  | 'careCase'
  | 'consentRecord'
  | 'dispenseTask'
  | 'facility'
  | 'firstVisitDocument'
  | 'managementPlan'
  | 'membership'
  | 'pharmacistShift'
  | 'task'
  | 'visitSchedule'
  | 'visitScheduleContactLog'
  | 'visitScheduleProposal'
  | 'visitVehicleResource'
>;

const dayBoardQuerySchema = z.object({
  date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional(),
});

const dayBoardSingleValueQueryNames = ['date'] as const satisfies readonly (keyof z.infer<
  typeof dayBoardQuerySchema
>)[];

function findInvalidDayBoardQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};

  for (const name of dayBoardSingleValueQueryNames) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }

  const rawDate = searchParams.get('date');
  if (rawDate != null && rawDate !== rawDate.trim()) {
    fieldErrors.date = ['日付形式が不正です（YYYY-MM-DD）'];
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

// 日付キー生成・@db.Date 比較は date-boundary ヘルパーに統一(JST 当日取りこぼし防止)

function isStringId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const SAFE_TASK_METADATA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function readSafeTaskMetadataId(value: unknown) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return SAFE_TASK_METADATA_ID_PATTERN.test(id) ? id : null;
}

function readSafeStringIdArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(readSafeTaskMetadataId).filter((id): id is string => id !== null)),
  ).slice(0, 10);
}

function sanitizeOperationalTaskMetadata(task: {
  task_type: string;
  metadata: unknown;
}): Record<string, unknown> | null {
  if (
    task.task_type !== 'visit_schedule_override_approval' ||
    typeof task.metadata !== 'object' ||
    task.metadata === null ||
    Array.isArray(task.metadata)
  ) {
    return null;
  }

  const metadata = task.metadata as Record<string, unknown>;
  const safeMetadata: Record<string, unknown> = {};
  const proposalIds = readSafeStringIdArray(metadata.proposal_ids);
  if (proposalIds.length > 0) safeMetadata.proposal_ids = proposalIds;
  const sourceScheduleId = readSafeTaskMetadataId(metadata.source_schedule_id);
  if (sourceScheduleId) {
    safeMetadata.source_schedule_id = sourceScheduleId;
  }

  return Object.keys(safeMetadata).length > 0 ? safeMetadata : null;
}

function isInboundScheduleRequestTask(taskType: string) {
  return taskType === 'pharmacy.inbound_schedule_request_review_required';
}

function scheduleReadyAsOf(schedule: Pick<DayBoardScheduleReadySource, 'scheduled_date'>) {
  return schedule.scheduled_date instanceof Date ? schedule.scheduled_date : new Date(0);
}

function serializeOperationalTask(task: {
  id: string;
  task_type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  due_date: Date | null;
  sla_due_at: Date | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Prisma.JsonValue | null;
  created_at: Date;
}): ScheduleDayBoardOperationalTask {
  return {
    id: task.id,
    task_type: task.task_type,
    title: isInboundScheduleRequestTask(task.task_type) ? '受信訪問調整を確認' : task.title,
    description: isInboundScheduleRequestTask(task.task_type) ? null : task.description,
    status: task.status as ScheduleDayBoardOperationalTask['status'],
    priority: task.priority as ScheduleDayBoardOperationalTask['priority'],
    assigned_to: task.assigned_to,
    due_date: task.due_date?.toISOString() ?? null,
    sla_due_at: task.sla_due_at?.toISOString() ?? null,
    related_entity_type: task.related_entity_type,
    related_entity_id: task.related_entity_id,
    metadata: sanitizeOperationalTaskMetadata(task),
    created_at: task.created_at.toISOString(),
  };
}

function minutesOfTimeValue(value: Date | null): number | null {
  return timeDateToMinutes(value);
}

function workdayAvailableMinutes(startMinutes: number, endMinutes: number): number {
  if (endMinutes <= startMinutes) return 0;
  const lunchOverlapMinutes = Math.max(
    0,
    Math.min(endMinutes, LUNCH_END_MINUTES) - Math.max(startMinutes, LUNCH_START_MINUTES),
  );
  return Math.max(0, endMinutes - startMinutes - lunchOverlapMinutes);
}

function shiftAvailableMinutes(
  shift:
    | {
        available: boolean;
        available_from: Date | null;
        available_to: Date | null;
      }
    | null
    | undefined,
): number {
  if (shift?.available === false) return 0;
  const startMinutes =
    minutesOfTimeValue(shift?.available_from ?? null) ?? DEFAULT_WORKDAY_START_MINUTES;
  const endMinutes = minutesOfTimeValue(shift?.available_to ?? null) ?? DEFAULT_WORKDAY_END_MINUTES;
  return workdayAvailableMinutes(startMinutes, endMinutes);
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

function buildDayBoardVehicleSitePoint(
  site:
    | {
        address: string | null;
        lat: number | null;
        lng: number | null;
      }
    | null
    | undefined,
): VehicleRouteDurationPoint | null {
  if (!site) return null;
  return {
    routeOrder: 0,
    lat: site.lat,
    lng: site.lng,
    address: site.address,
    startsAt: null,
  };
}

function formatRouteDurationMinutes(minutes: number) {
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

async function summarizeDayBoardVehicleRouteDuration(
  vehicle: DayBoardVehicleRouteSource,
  schedules: DayBoardVehicleRouteSchedule[],
): Promise<
  Pick<
    DayBoardVehicleResource,
    | 'max_route_duration_minutes'
    | 'route_duration_minutes'
    | 'route_duration_status'
    | 'route_duration_label'
  >
> {
  const maxRouteDurationMinutes = vehicle.max_route_duration_minutes ?? null;
  if (maxRouteDurationMinutes == null) {
    return {
      max_route_duration_minutes: null,
      route_duration_minutes: null,
      route_duration_status: 'not_limited',
      route_duration_label: '稼働上限なし',
    };
  }

  if (schedules.length === 0) {
    return {
      max_route_duration_minutes: maxRouteDurationMinutes,
      route_duration_minutes: 0,
      route_duration_status: 'within_limit',
      route_duration_label: `稼働 0分 / 上限 ${maxRouteDurationMinutes}分`,
    };
  }

  const routePoints = schedules.map((schedule) =>
    buildVehicleRoutePoint({
      scheduledDate: schedule.scheduled_date,
      routeOrder: schedule.route_order,
      timeWindowStart: schedule.time_window_start,
      residence: schedule.case_.patient.residences?.[0] ?? null,
    }),
  );
  const candidatePoint = routePoints[routePoints.length - 1];
  if (!candidatePoint) {
    return {
      max_route_duration_minutes: maxRouteDurationMinutes,
      route_duration_minutes: 0,
      route_duration_status: 'within_limit',
      route_duration_label: `稼働 0分 / 上限 ${maxRouteDurationMinutes}分`,
    };
  }

  const estimate = await estimateVehicleRouteDurationWithCandidate(
    buildDayBoardVehicleSitePoint(vehicle.site),
    routePoints.slice(0, -1),
    candidatePoint,
    createRoadTravelEstimator(vehicle.travel_mode as VisitRouteTravelMode),
    vehicle.travel_mode as VisitRouteTravelMode,
  );
  if (estimate.durationMinutes == null) {
    return {
      max_route_duration_minutes: maxRouteDurationMinutes,
      route_duration_minutes: null,
      route_duration_status: 'unverified',
      route_duration_label: `稼働上限 ${maxRouteDurationMinutes}分 未確認`,
    };
  }

  const roundedDurationMinutes = Math.round(estimate.durationMinutes * 10) / 10;
  const routeDurationLabel = `稼働 ${formatRouteDurationMinutes(
    roundedDurationMinutes,
  )}分 / 上限 ${maxRouteDurationMinutes}分`;
  return {
    max_route_duration_minutes: maxRouteDurationMinutes,
    route_duration_minutes: roundedDurationMinutes,
    route_duration_status:
      estimate.durationMinutes > maxRouteDurationMinutes ? 'exceeded' : 'within_limit',
    route_duration_label:
      estimate.durationMinutes > maxRouteDurationMinutes
        ? `${routeDurationLabel} 超過`
        : routeDurationLabel,
  };
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
  db: DayBoardDb,
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
      : db.consentRecord.findMany({
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
      : db.firstVisitDocument.findMany({
          where: { org_id: orgId, case_id: { in: caseIds } },
          orderBy: [{ case_id: 'asc' }, { created_at: 'desc' }],
          select: { case_id: true, delivered_at: true, created_at: true },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.managementPlan.findMany({
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
      : db.billingEvidence.findMany({
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
      total_count: VISIT_READY_PREPARATION_ITEMS.length,
      status: 'unknown',
      incomplete_labels: ['準備未確認'],
      ready_blocker_summary: schedule.ready_blocker_summary,
    };
  }

  const completedCount = VISIT_READY_PREPARATION_ITEMS.filter(
    ([field]) => schedule.preparation?.[field] === true,
  ).length;
  const incompleteLabels = buildVisitReadyReadinessBlockers(
    schedule.preparation,
    schedule.carry_items_status,
  );
  const carryItemsBlocked = incompleteLabels.includes(VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER);
  if (
    completedCount === VISIT_READY_PREPARATION_ITEMS.length &&
    !schedule.preparation?.prepared_at
  ) {
    incompleteLabels.unshift('準備完了時刻未確定');
  }

  return {
    completed_count: completedCount,
    total_count: VISIT_READY_PREPARATION_ITEMS.length,
    status: incompleteLabels.length === 0 ? 'ready' : carryItemsBlocked ? 'blocked' : 'incomplete',
    incomplete_labels: incompleteLabels,
    ready_blocker_summary: schedule.ready_blocker_summary,
  };
}

function visitNeedsPreparationAttention(visit: DayBoardVisit): boolean {
  return (
    visit.preparation_summary.status !== 'ready' ||
    Boolean(visit.preparation_summary.ready_blocker_summary?.blocked)
  );
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const invalidQueryParams = findInvalidDayBoardQueryParams(searchParams);
    if (invalidQueryParams) {
      return validationError('クエリパラメータが不正です', invalidQueryParams);
    }

    const parsed = parseSearchParams(dayBoardQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    // scheduled_date(@db.Date)は UTC midnight 保存。ローカル解釈の Date を渡すと
    // Prisma が UTC 日付へ切り捨てて前日扱いになる(JST で当日全件こぼれる)ため、
    // 日本国内の業務日キー → UTC midnight に正規化して比較する。
    const dateKey = parsed.data.date ?? japanDateKey(now);
    const dayStart = utcDateFromLocalKey(dateKey);
    const dayEnd = addUtcDays(dayStart, 1);
    const pendingProposalWhere = {
      org_id: ctx.orgId,
      proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
      proposed_date: { gte: dayStart, lt: dayEnd },
    };

    const responseData = await withOrgContext(
      ctx.orgId,
      async (db) => {
        const patientOperationalSummarySelect = buildPatientOperationalSummarySelect(ctx.orgId);
        const [
          memberships,
          schedules,
          openTaskGroups,
          pharmacistShifts,
          vehicleResources,
          proposals,
          pendingProposalTotalCount,
        ] = await Promise.all([
          db.membership.findMany({
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
          db.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              scheduled_date: { gte: dayStart, lt: dayEnd },
              schedule_status: { notIn: ['cancelled', 'rescheduled'] },
            },
            orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
            select: {
              id: true,
              display_id: true,
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
              cycle: { select: { overall_status: true } },
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
                  display_id: true,
                  patient: {
                    select: {
                      id: true,
                      display_id: true,
                      name: true,
                      ...patientOperationalSummarySelect,
                      contacts: {
                        where: { org_id: ctx.orgId, is_emergency_contact: true },
                        select: { id: true },
                      },
                      residences: {
                        where: { is_primary: true },
                        take: 1,
                        select: {
                          address: true,
                          lat: true,
                          lng: true,
                        },
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
          db.task.groupBy({
            by: ['assigned_to'],
            where: { org_id: ctx.orgId, status: { in: ['pending', 'in_progress'] } },
            _count: { id: true },
          }),
          db.pharmacistShift.findMany({
            where: {
              org_id: ctx.orgId,
              date: { gte: dayStart, lt: dayEnd },
            },
            select: {
              user_id: true,
              available: true,
              available_from: true,
              available_to: true,
            },
          }),
          db.visitVehicleResource.findMany({
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
              max_route_duration_minutes: true,
              available: true,
              site: {
                select: {
                  address: true,
                  lat: true,
                  lng: true,
                },
              },
            },
          }),
          db.visitScheduleProposal.findMany({
            where: pendingProposalWhere,
            orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }],
            take: PENDING_PROPOSAL_LIMIT,
            select: {
              id: true,
              display_id: true,
              visit_type: true,
              proposal_status: true,
              patient_contact_status: true,
              proposed_date: true,
              time_window_start: true,
              time_window_end: true,
              proposed_pharmacist_id: true,
              case_: {
                select: {
                  display_id: true,
                  patient: {
                    select: {
                      id: true,
                      display_id: true,
                      name: true,
                      ...patientOperationalSummarySelect,
                    },
                  },
                },
              },
            },
          }),
          db.visitScheduleProposal.count({
            where: pendingProposalWhere,
          }),
        ]);
        const dayCycleIds = Array.from(
          new Set(schedules.map((schedule) => schedule.cycle_id).filter(isStringId)),
        );
        const auditTaskGroups =
          dayCycleIds.length === 0
            ? []
            : await db.dispenseTask.groupBy({
                by: ['assigned_to'],
                where: { org_id: ctx.orgId, status: 'completed', cycle_id: { in: dayCycleIds } },
                _count: { id: true },
              });
        const reportPendingCount = schedules.filter(
          (schedule) => schedule.cycle?.overall_status === 'visit_completed',
        ).length;

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
            : await db.facility.findMany({
                where: { org_id: ctx.orgId, id: { in: facilityIds } },
                select: { id: true, name: true },
              });
        const facilityNameById = new Map(
          facilities.map((facility) => [facility.id, facility.name]),
        );
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
        const readyBlockerSummaryByScheduleId = await buildReadyBlockerSummaries(
          db,
          ctx.orgId,
          schedules,
        );

        const toBoardVisit = (schedule: (typeof schedules)[number]): DayBoardVisit => {
          const summarizedSchedule = attachVisitSchedulePatientSummary(schedule);
          const patient = summarizedSchedule.case_.patient;
          return {
            id: schedule.id,
            display_id: schedule.display_id,
            case_display_id: schedule.case_.display_id,
            patient_id: patient.id,
            patient_display_id: patient.display_id,
            patient_name: patient.name,
            patient_archive: summarizedSchedule.patient_summary?.archive ?? null,
            patient_summary: summarizedSchedule.patient_summary,
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
          };
        };

        // 同一ユーザーの重複 membership を除去しつつ、訪問のある担当者を優先して行数を絞る。
        // 当日シフトで不在(available=false)のメンバーはボードに出さない(デザイン 03: 休みはレーン非表示)
        const shiftByUserId = new Map(pharmacistShifts.map((shift) => [shift.user_id, shift]));
        const unavailableUserIds = new Set(
          pharmacistShifts.filter((shift) => !shift.available).map((shift) => shift.user_id),
        );
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
        const sortedStaffAll = [...staffAll].sort((left, right) => {
          if (left.role_kind !== right.role_kind) return left.role_kind === 'pharmacist' ? -1 : 1;
          if (left.visits.length !== right.visits.length) {
            return right.visits.length - left.visits.length;
          }
          return left.name.localeCompare(right.name, 'ja');
        });
        const staff = sortedStaffAll.slice(0, STAFF_ROW_LIMIT);
        const hiddenStaff = sortedStaffAll.slice(STAFF_ROW_LIMIT);

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
            : await db.visitSchedule.findMany({
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
        const pendingProposalEffectiveTotalCount = Math.max(
          pendingProposalTotalCount,
          proposals.length,
        );
        const hiddenProposalCount = Math.max(
          0,
          pendingProposalEffectiveTotalCount - proposals.length,
        );
        const hiddenProposalIds =
          hiddenProposalCount === 0
            ? []
            : (
                await db.visitScheduleProposal.findMany({
                  where: pendingProposalWhere,
                  orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }],
                  skip: PENDING_PROPOSAL_LIMIT,
                  select: { id: true },
                })
              ).map((proposal) => proposal.id);
        const proposalContactLogs =
          proposalIds.length === 0
            ? []
            : await db.visitScheduleContactLog.findMany({
                where: { org_id: ctx.orgId, proposal_id: { in: proposalIds } },
                orderBy: [{ proposal_id: 'asc' }, { called_at: 'desc' }],
                select: { proposal_id: true, callback_due_at: true },
              });
        const latestContactLogByProposalId = new Map<
          string,
          (typeof proposalContactLogs)[number]
        >();
        for (const contactLog of proposalContactLogs) {
          if (contactLog.proposal_id && !latestContactLogByProposalId.has(contactLog.proposal_id)) {
            latestContactLogByProposalId.set(contactLog.proposal_id, contactLog);
          }
        }

        const pendingProposals: DayBoardPendingProposal[] = proposals.map((proposal) => {
          const summarizedProposal = attachVisitSchedulePatientSummary(proposal);
          const patient = summarizedProposal.case_.patient;
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
          const shiftMinutes = shiftAvailableMinutes(
            shiftByUserId.get(proposal.proposed_pharmacist_id),
          );
          const idleBefore = Math.max(0, shiftMinutes - occupied);
          const proposalMinutes =
            visitOccupiedMinutes(proposal.time_window_start, proposal.time_window_end) +
            TRAVEL_MINUTES_PER_VISIT;
          const idleAfter = Math.max(0, idleBefore - proposalMinutes);

          const latestContactLog = latestContactLogByProposalId.get(proposal.id);

          return {
            id: proposal.id,
            display_id: proposal.display_id,
            case_display_id: proposal.case_.display_id,
            patient_id: patient.id,
            patient_display_id: patient.display_id,
            patient_name: patient.name,
            patient_archive: summarizedProposal.patient_summary?.archive ?? null,
            patient_summary: summarizedProposal.patient_summary,
            pharmacist_name: pharmacistNameById.get(proposal.proposed_pharmacist_id) ?? null,
            patient_contact_status: proposal.patient_contact_status,
            proposed_date: proposedDateKey,
            time_start: proposal.time_window_start?.toISOString() ?? null,
            badge_label:
              proposal.patient_contact_status === 'change_requested'
                ? '変更希望'
                : proposal.proposal_status === 'reschedule_pending'
                  ? '再調整'
                  : proposal.visit_type === 'initial'
                    ? '受入判断'
                    : '確定待ち',
            response_due_at: latestContactLog?.callback_due_at?.toISOString() ?? null,
            idle_before_minutes: idleBefore,
            idle_after_minutes: idleAfter,
          } satisfies DayBoardPendingProposal;
        });
        const visibleVisitIds = staff.flatMap((member) => member.visits).map((visit) => visit.id);
        const hiddenVisitIds = hiddenStaff
          .flatMap((member) => member.visits)
          .map((visit) => visit.id);
        const operationalTaskEntityFilters = [
          ...(visibleVisitIds.length > 0
            ? [
                {
                  related_entity_type: 'visit_schedule',
                  related_entity_id: { in: visibleVisitIds },
                },
              ]
            : []),
          ...(pendingProposals.length > 0
            ? [
                {
                  related_entity_type: 'visit_schedule_proposal',
                  related_entity_id: { in: pendingProposals.map((proposal) => proposal.id) },
                },
              ]
            : []),
        ];
        const hiddenProposalTaskFilter =
          hiddenProposalIds.length === 0
            ? null
            : {
                related_entity_type: 'visit_schedule_proposal',
                related_entity_id: { in: hiddenProposalIds },
              };
        const hiddenVisitTaskFilter =
          hiddenVisitIds.length === 0
            ? null
            : {
                related_entity_type: 'visit_schedule',
                related_entity_id: { in: hiddenVisitIds },
              };
        const assignmentScope =
          operationalTaskEntityFilters.length === 0 &&
          !hiddenProposalTaskFilter &&
          !hiddenVisitTaskFilter
            ? null
            : await resolveDashboardAssignmentScope({
                db,
                orgId: ctx.orgId,
                accessContext: ctx,
              });
        const operationalTasks =
          operationalTaskEntityFilters.length === 0 || !assignmentScope
            ? []
            : await db.task.findMany({
                where: {
                  org_id: ctx.orgId,
                  task_type: { in: [...SCHEDULE_BOARD_TASK_TYPES] },
                  status: { in: [...OPEN_OPERATIONAL_TASK_STATUSES] },
                  AND: [
                    buildDashboardTaskAssignmentWhere(assignmentScope),
                    { OR: operationalTaskEntityFilters },
                  ],
                },
                orderBy: [
                  { sla_due_at: 'asc' },
                  { due_date: 'asc' },
                  { created_at: 'desc' },
                  { id: 'desc' },
                ],
                take: OPERATIONAL_TASK_LIMIT,
                select: {
                  id: true,
                  task_type: true,
                  title: true,
                  description: true,
                  status: true,
                  priority: true,
                  assigned_to: true,
                  due_date: true,
                  sla_due_at: true,
                  related_entity_type: true,
                  related_entity_id: true,
                  metadata: true,
                  created_at: true,
                },
              });
        const hiddenOperationalTaskCount =
          !hiddenProposalTaskFilter || !assignmentScope
            ? 0
            : await db.task.count({
                where: {
                  org_id: ctx.orgId,
                  task_type: { in: [...SCHEDULE_BOARD_TASK_TYPES] },
                  status: { in: [...OPEN_OPERATIONAL_TASK_STATUSES] },
                  AND: [
                    buildDashboardTaskAssignmentWhere(assignmentScope),
                    hiddenProposalTaskFilter,
                  ],
                },
              });
        const hiddenStaffOperationalTaskCount =
          !hiddenVisitTaskFilter || !assignmentScope
            ? 0
            : await db.task.count({
                where: {
                  org_id: ctx.orgId,
                  task_type: { in: [...SCHEDULE_BOARD_TASK_TYPES] },
                  status: { in: [...OPEN_OPERATIONAL_TASK_STATUSES] },
                  AND: [buildDashboardTaskAssignmentWhere(assignmentScope), hiddenVisitTaskFilter],
                },
              });

        const auditPendingCount = auditTaskGroups.reduce((sum, group) => sum + group._count.id, 0);
        const assignedVehicleCounts = new Map<string, number>();
        const assignedVehicleSchedulesById = new Map<string, typeof schedules>();
        const unassignedAssignableVisitCountsBySite = new Map<string, number>();
        for (const schedule of schedules) {
          if (schedule.vehicle_resource_id) {
            assignedVehicleCounts.set(
              schedule.vehicle_resource_id,
              (assignedVehicleCounts.get(schedule.vehicle_resource_id) ?? 0) + 1,
            );
            const vehicleSchedules =
              assignedVehicleSchedulesById.get(schedule.vehicle_resource_id) ?? [];
            vehicleSchedules.push(schedule);
            assignedVehicleSchedulesById.set(schedule.vehicle_resource_id, vehicleSchedules);
          } else if (VEHICLE_ASSIGNABLE_STATUSES.has(schedule.schedule_status)) {
            const siteKey = schedule.site_id ?? '';
            unassignedAssignableVisitCountsBySite.set(
              siteKey,
              (unassignedAssignableVisitCountsBySite.get(siteKey) ?? 0) + 1,
            );
          }
        }
        const vehicleSummaries = await Promise.all(
          vehicleResources.map(async (vehicle): Promise<DayBoardVehicleSummary> => {
            const assignedVisitCount = assignedVehicleCounts.get(vehicle.id) ?? 0;
            const remainingStops = Math.max(0, vehicle.max_stops - assignedVisitCount);
            const matchingUnassignedVisitCount =
              unassignedAssignableVisitCountsBySite.get(vehicle.site_id ?? '') ?? 0;
            const routeDuration = await summarizeDayBoardVehicleRouteDuration(
              vehicle,
              assignedVehicleSchedulesById.get(vehicle.id) ?? [],
            );
            const routeDurationBlockerReason =
              routeDuration.route_duration_status === 'exceeded'
                ? '稼働上限を超過'
                : routeDuration.route_duration_status === 'unverified'
                  ? '稼働上限を未確認'
                  : null;
            return {
              id: vehicle.id,
              label: vehicle.label,
              site_id: vehicle.site_id,
              vehicle_code: vehicle.vehicle_code,
              travel_mode: vehicle.travel_mode,
              available: vehicle.available,
              max_stops: vehicle.max_stops,
              ...routeDuration,
              assigned_visit_count: assignedVisitCount,
              remaining_stops: remainingStops,
              matching_unassigned_visit_count: matchingUnassignedVisitCount,
              recommended: false,
              recommendation_reason: vehicle.available
                ? (routeDurationBlockerReason ??
                  (remainingStops > 0 ? `空き ${remainingStops}件` : '本日の上限に到達'))
                : '停止中',
            };
          }),
        );
        const recommendedVehicle = vehicleSummaries
          .filter(
            (vehicle) =>
              vehicle.available &&
              vehicle.remaining_stops > 0 &&
              (vehicle.route_duration_status === 'within_limit' ||
                vehicle.route_duration_status === 'not_limited'),
          )
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

        const visibleVisits = staff.flatMap((member) => member.visits);
        const hiddenVisits = hiddenStaff.flatMap((member) => member.visits);
        const totalVisitCount = visibleVisits.length + hiddenVisits.length;
        const visiblePreparationAttentionCount = visibleVisits.filter(
          visitNeedsPreparationAttention,
        ).length;
        const hiddenPreparationAttentionCount = hiddenVisits.filter(
          visitNeedsPreparationAttention,
        ).length;

        return {
          generated_at: now.toISOString(),
          date: dateKey,
          staff,
          staff_counts: {
            total_count: sortedStaffAll.length,
            visible_count: staff.length,
            hidden_count: hiddenStaff.length,
            total_visit_count: totalVisitCount,
            visible_visit_count: visibleVisits.length,
            hidden_visit_count: hiddenVisits.length,
            total_preparation_attention_count:
              visiblePreparationAttentionCount + hiddenPreparationAttentionCount,
            visible_preparation_attention_count: visiblePreparationAttentionCount,
            hidden_preparation_attention_count: hiddenPreparationAttentionCount,
            hidden_operational_task_count: hiddenStaffOperationalTaskCount,
            limit: STAFF_ROW_LIMIT,
          },
          audit_pending_count: auditPendingCount,
          report_pending_count: reportPendingCount,
          vehicle_resources: vehicleSummaries,
          pending_proposals: pendingProposals,
          pending_proposal_counts: {
            total_count: pendingProposalEffectiveTotalCount,
            visible_count: pendingProposals.length,
            hidden_count: hiddenProposalCount,
            limit: PENDING_PROPOSAL_LIMIT,
            hidden_operational_task_count: hiddenOperationalTaskCount,
          },
          operational_tasks: operationalTasks.map(serializeOperationalTask),
        } satisfies ScheduleDayBoardResponse;
      },
      { requestContext: ctx },
    );

    return success({ data: responseData });
  },
  {
    permission: 'canVisit',
    message: '訪問予定の閲覧権限がありません',
  },
);

export async function GET(
  req: NextRequest,
  routeContext: { params: Promise<Record<string, string>> },
) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
