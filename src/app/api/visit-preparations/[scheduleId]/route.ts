import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { deriveFacilityLabel, deriveVisitPlaceGroup } from '@/lib/utils/facility';
import { facilityPacketMemoToDisplayText } from '@/lib/visits/facility-packet';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { formatNullableDateKey } from '@/lib/date-key';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  success,
  validationError,
  notFound,
  forbiddenResponse,
  conflict,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { hasPermission } from '@/lib/auth/permissions';
import { upsertVisitPreparationSchema } from '@/lib/validations/visit-preparation';
import {
  buildChecklistFromTemplate,
  mergeChecklistWithTemplate,
} from '@/lib/visits/checklist-template';
import {
  describeOperationalTask,
  upsertOperationalTask,
  resolveOperationalTasks,
} from '@/server/services/operational-tasks';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import {
  buildVisitReadyReadinessBlockers,
  evaluateVisitScheduleReadyTransition,
  getVisitReadyTransitionErrorMessage,
  sanitizeVisitReadyTransitionDetails,
  type VisitReadyTransitionBlockers,
} from '@/server/services/visit-preparation-readiness';
import {
  getPatientHomeCareFeatureSummary,
  selectScheduleHomeCareFeatureHighlights,
} from '@/server/services/home-care-ops';
import { getScheduleVisitBrief } from '@/server/services/visit-brief';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import {
  DEFAULT_VISIT_ROUTE_SERVICE_MINUTES,
  computeOptimizedVisitRoute,
  visitRouteTimeWindowFromDbTime,
  type VisitRoutePlan,
  type VisitRouteTravelMode,
} from '@/server/services/visit-route-engine';
import { matchMedicationDiffLines } from '@/lib/prescription/medication-diff';
import {
  deriveOutsideMedEvidenceKind,
  OUTSIDE_MED_EVIDENCE_KIND_LABELS,
} from '@/lib/dispensing/outside-med-classification';
import { type OutsideMedEvidenceKind } from '@/lib/dispensing/set-audit-constants';

type IntakeLineSummary = {
  drug_name: string;
  drug_code: string | null;
  dose: string;
  frequency: string;
  days: number;
  start_date: Date | null;
  end_date: Date | null;
};

type MedicationIdentitySummary = {
  drug_name: string;
  drug_code: string | null;
};

type PreviousStructuredVisitReuse = {
  source_visit_record_id: string;
  source_visit_record_version: number | null;
  source_visit_record_updated_at: string | null;
  subjective: string[];
  objective: string[];
  assessment: string[];
  plan: string[];
  handoff: {
    next_check_items: string[];
    ongoing_monitoring: string[];
    decision_rationale: string | null;
  };
  carry_forward_items: string[];
};

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizeInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

function readRouteSnapshotVehicleResourceId(value: Prisma.InputJsonObject | null) {
  if (!value) return null;
  if (typeof value.vehicle_resource_id === 'string' && value.vehicle_resource_id.trim()) {
    return value.vehicle_resource_id.trim();
  }
  const vehicleResource = readJsonObject(value.vehicle_resource);
  const vehicleId = vehicleResource?.vehicle_id;
  return typeof vehicleId === 'string' && vehicleId.trim() ? vehicleId.trim() : null;
}

function readRouteSnapshotTravelMode(
  value: Prisma.InputJsonObject | null,
): VisitRouteTravelMode | null {
  if (!value) return null;
  const rawValue = value.travelMode ?? value.travel_mode;
  return rawValue === 'DRIVE' ||
    rawValue === 'BICYCLE' ||
    rawValue === 'WALK' ||
    rawValue === 'TWO_WHEELER'
    ? rawValue
    : null;
}

function appendRouteNote(note: string | null, next: string) {
  return note ? `${note} / ${next}` : next;
}

function buildVisitDayRange(date: Date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function normalizeRoutePlanSnapshotForWrite(
  plan: VisitRoutePlan,
  args: {
    scheduleIds: string[];
    routeOrder: number | null;
    vehicleResource: {
      id: string;
      label: string;
      max_stops: number | null;
      max_route_duration_minutes: number | null;
    } | null;
    generatedAt: Date;
  },
): Prisma.InputJsonObject {
  const vehicleLabel = args.vehicleResource?.label ?? args.vehicleResource?.id ?? '選択中の社用車';
  const vehicleConstraintExceeded =
    args.vehicleResource?.max_route_duration_minutes != null &&
    plan.totalDurationSeconds != null &&
    plan.totalDurationSeconds > args.vehicleResource.max_route_duration_minutes * 60;
  const vehicleConstraintUnverified =
    args.vehicleResource?.max_route_duration_minutes != null && plan.totalDurationSeconds == null;
  const note =
    args.vehicleResource == null
      ? plan.note
      : vehicleConstraintExceeded
        ? appendRouteNote(
            plan.note,
            `${vehicleLabel} の稼働上限 ${args.vehicleResource.max_route_duration_minutes}分を超えています`,
          )
        : vehicleConstraintUnverified
          ? appendRouteNote(plan.note, `${vehicleLabel} の稼働上限は経路時間未計算のため未確認です`)
          : appendRouteNote(plan.note, `${vehicleLabel} の車両リソース条件を確認済み`);

  return normalizeInputJsonObject({
    ...plan,
    note,
    ordered_schedule_ids: args.scheduleIds,
    orderedScheduleIds: plan.orderedScheduleIds,
    route_order: args.routeOrder,
    generated_by: 'server',
    generated_at: args.generatedAt.toISOString(),
    ...(args.vehicleResource
      ? {
          vehicle_resource_id: args.vehicleResource.id,
          vehicle_resource: {
            vehicle_id: args.vehicleResource.id,
            label: vehicleLabel,
            max_stops: args.vehicleResource.max_stops,
            max_route_duration_minutes: args.vehicleResource.max_route_duration_minutes,
            stop_count: args.scheduleIds.length,
            route_duration_minutes:
              plan.totalDurationSeconds == null ? null : Math.ceil(plan.totalDurationSeconds / 60),
            constraint_status: vehicleConstraintExceeded
              ? 'exceeded'
              : vehicleConstraintUnverified
                ? 'unverified'
                : 'ok',
          },
        }
      : {}),
  });
}

type FacilityParallelSchedule = {
  id: string;
  route_order: number | null;
  schedule_status: string;
  medication_start_date: Date | null;
  medication_end_date: Date | null;
  preparation: {
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
  } | null;
  visit_record: {
    id: string;
    outcome_status: string;
  } | null;
  case_: {
    patient: {
      id: string;
      name: string;
      name_kana: string | null;
      birth_date: Date | null;
      gender: string | null;
      residences: Array<{
        address: string;
        facility_id: string | null;
        facility_unit_id: string | null;
        building_id: string | null;
        unit_name: string | null;
      }>;
    };
  };
};

type ConferenceSectionSummary = {
  key: string;
  label?: string;
  body?: string;
};

type ConferenceParticipantSummary = {
  name?: string | null;
  role?: string | null;
};

type ConferenceSyncSummary = {
  billing_candidate_id?: string | null;
  visit_proposal_id?: string | null;
  report_draft_ids?: string[];
  tasks_created?: number;
  medication_issues_created?: number;
};

type BillingCollectionSnapshot = {
  status: string | null;
  billed_amount: number | null;
  collected_amount: number | null;
  unpaid_amount: number | null;
  payment_method: string | null;
  payer_name: string | null;
  scheduled_collection_at: string | null;
  collected_at: string | null;
  receipt_number: string | null;
  receipt_issue_status: string | null;
  updated_by: string | null;
};

const BILLING_PAYMENT_PROFILE_TASK_TYPE = 'patient_billing_payment_profile';

const BILLING_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: '現金',
  bank_transfer: '振込',
  bank_debit: '口座振替',
  credit_card: 'クレカ',
  facility_billing: '施設請求',
  corporate_billing: '法人請求',
  other: 'その他',
};

const BILLING_COLLECTION_TIMING_LABELS: Record<string, string> = {
  per_visit: '毎回',
  month_end: '月末',
  next_month: '翌月',
  facility_batch: '施設一括',
  other: 'その他',
};

const BILLING_RECEIPT_ISSUE_LABELS: Record<string, string> = {
  paper: '紙',
  pdf: 'PDF',
  none: '不要',
};

const BILLING_DOCUMENT_ISSUE_STATUS_LABELS: Record<string, string> = {
  not_required: '不要',
  not_issued: '未発行',
  issued: '発行済',
};

const VISIT_PREPARATION_CONFERENCE_NOTE_TYPES = new Set(['pre_discharge', 'service_manager']);
type VisitPreparationConferenceNoteType = 'pre_discharge' | 'service_manager';

function isVisitPreparationConferenceNoteType(
  value: string,
): value is VisitPreparationConferenceNoteType {
  return VISIT_PREPARATION_CONFERENCE_NOTE_TYPES.has(value);
}

function summarizePrescriptionChanges(
  currentLines: IntakeLineSummary[],
  previousLines: IntakeLineSummary[],
) {
  const added: string[] = [];
  const added_medications: MedicationIdentitySummary[] = [];
  const changed: Array<{
    drug_name: string;
    drug_code: string | null;
    previous_drug_name: string;
    previous_drug_code: string | null;
    reasons: string[];
  }> = [];
  const removed: string[] = [];
  const removed_medications: MedicationIdentitySummary[] = [];

  for (const match of matchMedicationDiffLines(currentLines, previousLines)) {
    const line = match.current;
    const previous = match.previous;

    if (line && !previous) {
      added.push(line.drug_name);
      added_medications.push({ drug_name: line.drug_name, drug_code: line.drug_code });
      continue;
    }

    if (!line && previous) {
      removed.push(previous.drug_name);
      removed_medications.push({ drug_name: previous.drug_name, drug_code: previous.drug_code });
      continue;
    }

    if (!line || !previous) continue;

    const reasons: string[] = [];
    if (previous.dose !== line.dose) reasons.push(`用量 ${previous.dose} → ${line.dose}`);
    if (previous.frequency !== line.frequency) {
      reasons.push(`用法 ${previous.frequency} → ${line.frequency}`);
    }
    if (previous.days !== line.days) reasons.push(`日数 ${previous.days}日 → ${line.days}日`);

    if (reasons.length > 0) {
      changed.push({
        drug_name: line.drug_name,
        drug_code: line.drug_code,
        previous_drug_name: previous.drug_name,
        previous_drug_code: previous.drug_code,
        reasons,
      });
    }
  }

  return {
    added,
    added_medications,
    changed,
    removed,
    removed_medications,
  };
}

function toDateString(value: Date | null | undefined) {
  return formatNullableDateKey(value);
}

function countPreparationBlockers(preparation: FacilityParallelSchedule['preparation']) {
  return [
    !preparation?.medication_changes_reviewed,
    !preparation?.carry_items_confirmed,
    !preparation?.previous_issues_reviewed,
    !preparation?.route_confirmed,
    !preparation?.offline_synced,
  ].filter(Boolean).length;
}

function buildPreviousVisitSummary(
  previousVisit: {
    visit_date: Date;
    outcome_status: string;
    soap_plan: string | null;
    next_visit_suggestion_date: Date | null;
  } | null,
) {
  if (!previousVisit) return null;
  const parts = [
    `前回 ${toDateString(previousVisit.visit_date) ?? ''}`,
    `結果: ${previousVisit.outcome_status}`,
    previousVisit.soap_plan ? `計画: ${previousVisit.soap_plan}` : null,
    previousVisit.next_visit_suggestion_date
      ? `次回提案: ${toDateString(previousVisit.next_visit_suggestion_date)}`
      : null,
  ].filter((value): value is string => Boolean(value));
  return parts.join(' / ');
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function readTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function buildPreviousStructuredVisitReuse(
  previousVisit: {
    id: string;
    version: number | null;
    updated_at: Date | null;
    structured_soap: Prisma.JsonValue | null;
  } | null,
): PreviousStructuredVisitReuse | null {
  if (!previousVisit) return null;
  const structuredSoap = readJsonObject(previousVisit.structured_soap);
  if (!structuredSoap) return null;

  const subjective = readJsonObject(structuredSoap.subjective);
  const objective = readJsonObject(structuredSoap.objective);
  const assessment = readJsonObject(structuredSoap.assessment);
  const plan = readJsonObject(structuredSoap.plan);
  const handoff = readJsonObject(structuredSoap.handoff);
  const homeVisit2026 = readJsonObject(structuredSoap.home_visit_2026);
  const adverseEvents = readJsonObject(objective?.adverse_events);
  const residualMedications = Array.isArray(structuredSoap.residual_medications)
    ? structuredSoap.residual_medications
        .map((item) => readJsonObject(item))
        .filter((item): item is Record<string, unknown> => item != null)
    : [];

  const residualLines = residualMedications
    .map((item) => {
      const drugName = readTrimmedString(item.drug_name);
      if (!drugName) return null;
      const remainingQuantity =
        typeof item.remaining_quantity === 'number' ? item.remaining_quantity : null;
      const excessDays = typeof item.excess_days === 'number' ? item.excess_days : null;
      const amount = [
        remainingQuantity != null ? `${remainingQuantity}錠` : null,
        excessDays != null ? `${excessDays}日分過多` : null,
      ].filter(Boolean);
      return amount.length > 0 ? `${drugName} ${amount.join(' / ')}` : drugName;
    })
    .filter((item): item is string => item != null);

  const subjectiveLines = [
    ...readStringArray(subjective?.symptom_checks).map((item) => `症状: ${item}`),
    readTrimmedString(subjective?.free_text),
  ].filter((item): item is string => item != null);

  const objectiveLines = [
    readTrimmedString(objective?.medication_status)
      ? `服薬状況: ${readTrimmedString(objective?.medication_status)}`
      : null,
    typeof objective?.adherence_score === 'number'
      ? `アドヒアランス: ${objective.adherence_score}/5`
      : null,
    ...readStringArray(objective?.side_effect_checks).map((item) => `副作用確認: ${item}`),
    ...readStringArray(adverseEvents?.events).map((item) => `有害事象: ${item}`),
    readTrimmedString(adverseEvents?.details)
      ? `有害事象詳細: ${readTrimmedString(adverseEvents?.details)}`
      : null,
    residualLines.length > 0 ? `残薬: ${residualLines.slice(0, 3).join('、')}` : null,
    readTrimmedString(objective?.free_text),
  ].filter((item): item is string => item != null);

  const assessmentLines = [
    ...readStringArray(assessment?.problem_checks).map((item) => `課題: ${item}`),
    ...readStringArray(assessment?.drug_related_problems).map((item) => `薬学的問題: ${item}`),
    readTrimmedString(assessment?.severity)
      ? `重症度: ${readTrimmedString(assessment?.severity)}`
      : null,
    readTrimmedString(assessment?.free_text),
  ].filter((item): item is string => item != null);

  const planLines = [
    ...readStringArray(plan?.intervention_checks).map((item) => `介入: ${item}`),
    readTrimmedString(plan?.next_visit_date)
      ? `次回目安: ${readTrimmedString(plan?.next_visit_date)}`
      : null,
    readTrimmedString(plan?.prescription_proposal)
      ? `処方提案: ${readTrimmedString(plan?.prescription_proposal)}`
      : null,
    readTrimmedString(plan?.physician_report_items)
      ? `医師へ: ${readTrimmedString(plan?.physician_report_items)}`
      : null,
    readTrimmedString(plan?.care_manager_report_items)
      ? `ケアマネへ: ${readTrimmedString(plan?.care_manager_report_items)}`
      : null,
    readTrimmedString(plan?.care_service_coordination)
      ? `介護サービスへ: ${readTrimmedString(plan?.care_service_coordination)}`
      : null,
    readTrimmedString(plan?.free_text),
  ].filter((item): item is string => item != null);

  const handoffNextCheckItems = readStringArray(handoff?.next_check_items);
  const handoffOngoingMonitoring = readStringArray(handoff?.ongoing_monitoring);
  const decisionRationale = readTrimmedString(handoff?.decision_rationale);
  const carryForwardItems = [
    ...handoffNextCheckItems,
    residualLines.length > 0 ? `前回残薬: ${residualLines.slice(0, 2).join('、')}` : null,
    ...readStringArray(objective?.side_effect_checks).map((item) => `副作用再確認: ${item}`),
    ...readStringArray(adverseEvents?.events).map((item) => `有害事象フォロー: ${item}`),
    homeVisit2026?.residual_medication_checked === false ? '前回未確認: 残薬' : null,
    readTrimmedString(plan?.physician_report_items)
      ? `医師共有後の変化: ${readTrimmedString(plan?.physician_report_items)}`
      : null,
    readTrimmedString(plan?.care_manager_report_items)
      ? `ケアマネ共有後の変化: ${readTrimmedString(plan?.care_manager_report_items)}`
      : null,
    readTrimmedString(plan?.free_text),
  ].filter((item): item is string => item != null);

  const uniqueCarryForwardItems = Array.from(new Set(carryForwardItems)).slice(0, 8);
  const hasReusableData =
    subjectiveLines.length > 0 ||
    objectiveLines.length > 0 ||
    assessmentLines.length > 0 ||
    planLines.length > 0 ||
    handoffNextCheckItems.length > 0 ||
    handoffOngoingMonitoring.length > 0 ||
    decisionRationale != null ||
    uniqueCarryForwardItems.length > 0;

  if (!hasReusableData) return null;

  return {
    source_visit_record_id: previousVisit.id,
    source_visit_record_version: previousVisit.version,
    source_visit_record_updated_at: previousVisit.updated_at?.toISOString() ?? null,
    subjective: subjectiveLines.slice(0, 5),
    objective: objectiveLines.slice(0, 6),
    assessment: assessmentLines.slice(0, 5),
    plan: planLines.slice(0, 6),
    handoff: {
      next_check_items: handoffNextCheckItems.slice(0, 6),
      ongoing_monitoring: handoffOngoingMonitoring.slice(0, 6),
      decision_rationale: decisionRationale,
    },
    carry_forward_items: uniqueCarryForwardItems,
  };
}

function buildPreparationTaskKey(scheduleId: string) {
  return `visit-preparation:${scheduleId}`;
}

const MARK_READY_SOURCE_STATUSES = new Set(['planned', 'in_preparation']);
const MARK_READY_SATISFIED_STATUSES = new Set(['ready', 'departed', 'in_progress', 'completed']);

class VisitPreparationReadyTransitionError extends Error {
  constructor(readonly details: VisitReadyTransitionBlockers) {
    super(getVisitReadyTransitionErrorMessage(details));
    this.name = 'VisitPreparationReadyTransitionError';
  }
}

class VisitPreparationScheduleConflictError extends Error {
  constructor() {
    super('訪問予定が同時に更新されました。再読み込みしてください');
    this.name = 'VisitPreparationScheduleConflictError';
  }
}

function parseConferenceSections(value: Prisma.JsonValue | null): ConferenceSectionSummary[] {
  const sections = readJsonObject(value)?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section): ConferenceSectionSummary[] => {
    const record = readJsonObject(section);
    if (!record || typeof record.key !== 'string') return [];
    return [
      {
        key: record.key,
        label: typeof record.label === 'string' ? record.label : undefined,
        body: typeof record.body === 'string' ? record.body : undefined,
      },
    ];
  });
}

function parseConferenceParticipants(value: Prisma.JsonValue): ConferenceParticipantSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((participant): ConferenceParticipantSummary[] => {
    const record = readJsonObject(participant);
    if (!record) return [];
    return [
      {
        name: typeof record.name === 'string' ? record.name : null,
        role: typeof record.role === 'string' ? record.role : null,
      },
    ];
  });
}

function parseConferenceActionItems(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const record = readJsonObject(item);
      if (record) return typeof record.title === 'string' ? record.title.trim() : '';
      return '';
    })
    .filter((title) => title.length > 0);
}

function readConferenceSectionBody(sections: ConferenceSectionSummary[], keys: string[]) {
  for (const key of keys) {
    const body = sections.find((section) => section.key === key)?.body?.trim();
    if (body) return body;
  }
  return null;
}

function parseConferenceSyncSummary(value: Prisma.JsonValue | null): ConferenceSyncSummary | null {
  const sync = readJsonObject(readJsonObject(value)?.sync_summary);
  if (!sync) return null;
  return {
    billing_candidate_id:
      typeof sync.billing_candidate_id === 'string' ? sync.billing_candidate_id : null,
    visit_proposal_id: typeof sync.visit_proposal_id === 'string' ? sync.visit_proposal_id : null,
    report_draft_ids: Array.isArray(sync.report_draft_ids)
      ? sync.report_draft_ids.filter((id): id is string => typeof id === 'string')
      : undefined,
    tasks_created: typeof sync.tasks_created === 'number' ? sync.tasks_created : undefined,
    medication_issues_created:
      typeof sync.medication_issues_created === 'number'
        ? sync.medication_issues_created
        : undefined,
  };
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBillingCollection(calculationBreakdown: unknown): BillingCollectionSnapshot | null {
  const collection = readJsonObject(readJsonObject(calculationBreakdown)?.collection);
  if (!collection) return null;

  return {
    status: readString(collection.status),
    billed_amount: readNumber(collection.billed_amount),
    collected_amount: readNumber(collection.collected_amount),
    unpaid_amount: readNumber(collection.unpaid_amount),
    payment_method: readString(collection.payment_method),
    payer_name: readString(collection.payer_name),
    scheduled_collection_at: readString(collection.scheduled_collection_at),
    collected_at: readString(collection.collected_at),
    receipt_number: readString(collection.receipt_number),
    receipt_issue_status: readString(collection.receipt_issue_status),
    updated_by: readString(collection.updated_by),
  };
}

function estimateBillingCandidateAmount(candidate: {
  points: number | null;
  calculation_breakdown: Prisma.JsonValue | null;
}) {
  const breakdown = readJsonObject(candidate.calculation_breakdown);
  return readNumber(breakdown?.amount_yen) ?? candidate.points ?? null;
}

function resolveCollectionOutstandingAmount(
  collection: BillingCollectionSnapshot | null,
  estimatedAmount: number | null,
) {
  if (!collection) return estimatedAmount;
  if (collection.unpaid_amount != null) return collection.unpaid_amount;
  if (collection.billed_amount != null) {
    return Math.max(collection.billed_amount - (collection.collected_amount ?? 0), 0);
  }
  return estimatedAmount;
}

function buildConferenceHighlights(
  noteType: VisitPreparationConferenceNoteType,
  sections: ConferenceSectionSummary[],
) {
  const keys =
    noteType === 'pre_discharge'
      ? [
          ['退院予定', ['target_discharge_date', 'discharge_plan', 'discharge_background']],
          ['退院時薬剤変更', ['medication_changes_on_discharge', 'medication_summary']],
          ['初回訪問計画', ['next_visit_plan']],
          ['役割分担', ['team_roles', 'care_team_roles']],
        ]
      : [
          ['ケアプラン変更', ['care_plan_changes', 'care_plan_update']],
          ['訪問調整', ['visit_schedule_adjustment', 'service_adjustments']],
          ['服薬レビュー', ['medication_review', 'medication_related_items']],
          ['連携事項', ['coordination_items', 'agreed_actions']],
        ];

  return keys
    .map(([label, sectionKeys]) => {
      const body = readConferenceSectionBody(sections, sectionKeys as string[]);
      if (!body) return null;
      return `${label}: ${body.replace(/\s+/g, ' ').slice(0, 120)}`;
    })
    .filter((value): value is string => value !== null);
}

async function authenticatedGET(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問準備情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { scheduleId } = await params;
  const normalizedScheduleId = normalizeRequiredRouteParam(scheduleId);
  if (!normalizedScheduleId) return validationError('訪問予定IDが不正です');

  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: normalizedScheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      scheduled_date: true,
      time_window_start: true,
      time_window_end: true,
      visit_type: true,
      schedule_status: true,
      carry_items_status: true,
      priority: true,
      pharmacist_id: true,
      facility_batch_id: true,
      facility_batch: {
        select: {
          notes: true,
        },
      },
      route_order: true,
      medication_start_date: true,
      medication_end_date: true,
      assignment_mode: true,
      escalation_reason: true,
      confirmed_at: true,
      site: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
      visit_record: {
        select: {
          id: true,
          outcome_status: true,
        },
      },
      preparation: true,
      override_request: {
        select: {
          id: true,
          status: true,
          reason: true,
          impact_summary: true,
        },
      },
      applied_override: {
        select: {
          id: true,
          reason: true,
          source_schedule: {
            select: {
              scheduled_date: true,
              time_window_start: true,
              time_window_end: true,
              pharmacist_id: true,
            },
          },
        },
      },
      case_: {
        select: {
          id: true,
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
          required_visit_support: true,
          patient: {
            select: {
              id: true,
              name: true,
              name_kana: true,
              birth_date: true,
              gender: true,
              residences: {
                where: { is_primary: true },
                take: 1,
                select: {
                  address: true,
                  facility_id: true,
                  facility_unit_id: true,
                  building_id: true,
                  unit_name: true,
                },
              },
              contacts: {
                where: { is_emergency_contact: true },
                select: {
                  id: true,
                  name: true,
                  relation: true,
                  phone: true,
                },
              },
              consents: {
                where: {
                  consent_type: 'visit_medication_management',
                  is_active: true,
                  revoked_date: null,
                },
                select: { id: true },
              },
              scheduling_preference: {
                select: {
                  visit_before_contact_required: true,
                  first_visit_preferred_date: true,
                  first_visit_time_slot: true,
                  first_visit_time_note: true,
                  parking_available: true,
                  primary_contact_preference: true,
                  mcs_linked: true,
                },
              },
            },
          },
          care_team_links: {
            orderBy: { role: 'asc' },
            select: {
              id: true,
              role: true,
              name: true,
              organization_name: true,
              phone: true,
            },
          },
          management_plans: {
            where: { status: 'approved' },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, schedule)) {
    return forbiddenResponse('この訪問予定の準備情報を閲覧する権限がありません');
  }
  const canAccessParallelVisitContext =
    ctx.role === 'owner' || ctx.role === 'admin' || schedule.pharmacist_id === ctx.userId;

  const preparation = schedule.preparation;
  const primaryResidence = schedule.case_.patient.residences[0] ?? null;

  const caseData = schedule.case_;
  const patient = caseData.patient;

  const [scopedVisitRecords, scopedMedicationCycles] = await Promise.all([
    prisma.visitRecord.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: schedule.case_.patient.id,
        schedule: {
          case_id: schedule.case_id,
        },
      },
      select: { id: true },
    }),
    prisma.medicationCycle.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: schedule.case_.patient.id,
        case_id: schedule.case_id,
      },
      select: { id: true },
    }),
  ]);
  const scopedVisitRecordIds = scopedVisitRecords.map((item) => item.id);
  const scopedCycleIds = scopedMedicationCycles.map((item) => item.id);

  const [
    billingEvidence,
    billingCandidates,
    billingPaymentProfileTask,
    recentPrescriptionIntakes,
    firstVisitDoc,
    recentConferenceNotes,
  ] = await Promise.all([
    listBillingEvidenceBlockers(prisma, {
      orgId: ctx.orgId,
      patientId: schedule.case_.patient.id,
      visitRecordIds: scopedVisitRecordIds,
      cycleIds: scopedCycleIds,
      limit: 4,
    }),
    prisma.billingCandidate.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: schedule.case_.patient.id,
        ...(scopedCycleIds.length === 0
          ? { id: { in: [] } }
          : { cycle_id: { in: scopedCycleIds } }),
        status: {
          not: 'excluded',
        },
      },
      orderBy: [{ billing_month: 'desc' }, { updated_at: 'desc' }],
      select: {
        id: true,
        billing_month: true,
        billing_name: true,
        points: true,
        status: true,
        calculation_breakdown: true,
        updated_at: true,
      },
    }),
    prisma.task.findFirst({
      where: {
        org_id: ctx.orgId,
        task_type: BILLING_PAYMENT_PROFILE_TASK_TYPE,
        related_entity_type: 'patient',
        related_entity_id: schedule.case_.patient.id,
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        metadata: true,
      },
    }),
    prisma.prescriptionIntake.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: {
          patient_id: schedule.case_.patient.id,
          case_id: schedule.case_id,
        },
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
      take: 2,
      select: {
        id: true,
        source_type: true,
        prescribed_date: true,
        lines: {
          orderBy: { line_number: 'asc' },
          select: {
            id: true,
            drug_name: true,
            drug_master_id: true,
            drug_code: true,
            dose: true,
            frequency: true,
            days: true,
            start_date: true,
            end_date: true,
            // その他薬分類(§11-7)の導出に必要なフィールドを追加 select する。
            route: true,
            dosage_form: true,
            unit: true,
            packaging_instructions: true,
            packaging_instruction_tags: true,
            notes: true,
          },
        },
      },
    }),
    prisma.firstVisitDocument.findFirst({
      where: {
        org_id: ctx.orgId,
        case_id: schedule.case_id,
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        delivered_at: true,
        delivered_to: true,
      },
    }),
    prisma.conferenceNote.findMany({
      where: {
        org_id: ctx.orgId,
        note_type: {
          in: ['pre_discharge', 'service_manager'],
        },
        OR: [
          { case_id: schedule.case_id },
          { patient_id: schedule.case_.patient.id, case_id: null },
        ],
      },
      orderBy: [{ conference_date: 'desc' }, { updated_at: 'desc' }],
      take: 4,
      select: {
        id: true,
        note_type: true,
        title: true,
        conference_date: true,
        participants: true,
        structured_content: true,
        metadata: true,
        action_items: true,
      },
    }),
  ]);

  const [previousVisit, openTasks, recentContactLogs, sameDaySchedules] = await Promise.all([
    prisma.visitRecord.findFirst({
      where: {
        org_id: ctx.orgId,
        schedule: {
          case_id: schedule.case_id,
        },
        visit_date: {
          lt: schedule.scheduled_date,
        },
        schedule_id: {
          not: schedule.id,
        },
      },
      orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        visit_date: true,
        outcome_status: true,
        soap_plan: true,
        structured_soap: true,
        next_visit_suggestion_date: true,
        version: true,
        updated_at: true,
      },
    }),
    prisma.task.findMany({
      where: {
        org_id: ctx.orgId,
        status: {
          in: ['pending', 'in_progress'],
        },
        OR: [
          {
            related_entity_type: 'visit_schedule',
            related_entity_id: schedule.id,
          },
          {
            related_entity_type: 'case',
            related_entity_id: schedule.case_id,
          },
        ],
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 6,
      select: {
        id: true,
        task_type: true,
        title: true,
        description: true,
        priority: true,
        assigned_to: true,
        due_date: true,
        sla_due_at: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    }),
    prisma.visitScheduleContactLog.findMany({
      where: {
        org_id: ctx.orgId,
        OR: [{ schedule_id: schedule.id }, { case_id: schedule.case_id }],
      },
      orderBy: [{ called_at: 'desc' }],
      take: 4,
      select: {
        outcome: true,
        contact_method: true,
        note: true,
        callback_due_at: true,
        called_at: true,
      },
    }),
    canAccessParallelVisitContext
      ? prisma.visitSchedule.findMany({
          where: {
            org_id: ctx.orgId,
            scheduled_date: schedule.scheduled_date,
            pharmacist_id: schedule.pharmacist_id,
            id: {
              not: schedule.id,
            },
            schedule_status: {
              in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress', 'completed'],
            },
          },
          orderBy: [{ time_window_start: 'asc' }],
          select: {
            id: true,
            route_order: true,
            schedule_status: true,
            medication_start_date: true,
            medication_end_date: true,
            preparation: {
              select: {
                medication_changes_reviewed: true,
                carry_items_confirmed: true,
                previous_issues_reviewed: true,
                route_confirmed: true,
                offline_synced: true,
              },
            },
            visit_record: {
              select: {
                id: true,
                outcome_status: true,
              },
            },
            case_: {
              select: {
                patient: {
                  select: {
                    id: true,
                    name: true,
                    name_kana: true,
                    birth_date: true,
                    gender: true,
                    residences: {
                      where: { is_primary: true },
                      take: 1,
                      select: {
                        address: true,
                        facility_id: true,
                        facility_unit_id: true,
                        building_id: true,
                        unit_name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const onboarding_readiness = {
    consent_obtained: (patient.consents?.length ?? 0) > 0,
    emergency_contact_set: (patient.contacts?.length ?? 0) > 0,
    first_visit_doc_delivered: firstVisitDoc?.delivered_at != null,
    management_plan_approved: (caseData.management_plans?.length ?? 0) > 0,
    primary_physician_set: caseData.care_team_links?.some((l) => l.role === 'physician') ?? false,
  };

  // HVI-01C: build intake_context from home_visit_intake JSON and scheduling_preference
  const intakeData = getHomeVisitIntake(caseData.required_visit_support);
  const schedulingPref = patient.scheduling_preference;

  const intake_context = {
    // From scheduling_preference (structured, HVI-01B)
    visit_before_contact_required: schedulingPref?.visit_before_contact_required ?? null,
    first_visit_preferred_date:
      schedulingPref?.first_visit_preferred_date instanceof Date
        ? schedulingPref.first_visit_preferred_date.toISOString().split('T')[0]
        : ((schedulingPref?.first_visit_preferred_date as string | null | undefined) ?? null),
    first_visit_time_slot: schedulingPref?.first_visit_time_slot ?? null,
    first_visit_time_note: schedulingPref?.first_visit_time_note ?? null,
    parking_available: schedulingPref?.parking_available ?? null,
    primary_contact_preference: schedulingPref?.primary_contact_preference ?? null,
    mcs_linked: schedulingPref?.mcs_linked ?? null,

    // From home_visit_intake JSON (CareCase.required_visit_support)
    money_management: intakeData?.money_management ?? null,
    family_key_person: intakeData?.family_key_person ?? null,
    care_level: intakeData?.care_level ?? null,
    adl_level: intakeData?.adl_level ?? null,
    dementia_level: intakeData?.dementia_level ?? null,
    special_medical_procedures: intakeData?.special_medical_procedures ?? [],
    special_medical_notes: intakeData?.special_medical_notes ?? null,
    ent_prescription: intakeData?.ent_prescription ?? null,
    narcotics_base: intakeData?.narcotics_base ?? null,
    narcotics_rescue: intakeData?.narcotics_rescue ?? null,
    infection_isolation: intakeData?.infection_isolation ?? null,
    residual_medication_status: intakeData?.residual_medication_status ?? null,
    medication_support_methods: intakeData?.medication_support_methods ?? [],
    initial_transition_management_expected:
      intakeData?.initial_transition_management_expected ?? null,
  };

  const sameFacilitySchedules = sameDaySchedules.filter((item) => {
    const residence = item.case_.patient.residences[0] ?? null;
    const primaryGroup = deriveVisitPlaceGroup(primaryResidence ?? null);
    const targetGroup = deriveVisitPlaceGroup(residence ?? null);
    return Boolean(primaryGroup && targetGroup && primaryGroup.key === targetGroup.key);
  });

  const readinessBlockers = buildVisitReadyReadinessBlockers(
    preparation,
    schedule.carry_items_status,
  );
  const homeCareFeatureSummary = await getPatientHomeCareFeatureSummary(prisma, {
    orgId: ctx.orgId,
    patientId: schedule.case_.patient.id,
  });
  const visitBrief = await getScheduleVisitBrief(prisma, {
    orgId: ctx.orgId,
    patientId: schedule.case_.patient.id,
    caseIds: [schedule.case_id],
    currentScheduleId: schedule.id,
    scheduledDate: schedule.scheduled_date,
  });
  const latestIntake = recentPrescriptionIntakes[0] ?? null;
  const previousIntake = recentPrescriptionIntakes[1] ?? null;

  // その他薬(セット外で持ち出す薬: 外用/頓服/注射/液剤/冷所)の分類を最新処方明細から導出し、
  // 訪問準備 UI が同一語彙で表示できるよう server projection する(§11-7)。
  // FE 側で部分フィールドから再導出させない(outside_med_kind/label を消費)。
  const outsideMeds = (latestIntake?.lines ?? [])
    .map((line) => {
      const kind = deriveOutsideMedEvidenceKind(line);
      return kind
        ? {
            line_id: line.id,
            drug_name: line.drug_name,
            outside_med_kind: kind,
            outside_med_label: OUTSIDE_MED_EVIDENCE_KIND_LABELS[kind],
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        line_id: string;
        drug_name: string;
        outside_med_kind: OutsideMedEvidenceKind;
        outside_med_label: string;
      } => item !== null,
    );
  const prescriptionChanges =
    latestIntake && previousIntake
      ? {
          current_prescribed_date: latestIntake.prescribed_date.toISOString(),
          previous_prescribed_date: previousIntake.prescribed_date.toISOString(),
          source_type: latestIntake.source_type,
          ...summarizePrescriptionChanges(latestIntake.lines, previousIntake.lines),
        }
      : latestIntake
        ? {
            current_prescribed_date: latestIntake.prescribed_date.toISOString(),
            previous_prescribed_date: null,
            source_type: latestIntake.source_type,
            added: latestIntake.lines.map((line) => line.drug_name),
            added_medications: latestIntake.lines.map((line) => ({
              drug_name: line.drug_name,
              drug_code: line.drug_code,
            })),
            changed: [],
            removed: [],
            removed_medications: [],
          }
        : null;
  const medicationPeriod = {
    schedule_start_date: toDateString(schedule.medication_start_date),
    schedule_end_date: toDateString(schedule.medication_end_date),
    prescription_start_date:
      latestIntake?.lines
        .map((line) => line.start_date)
        .filter((value): value is Date => value != null)
        .sort((left, right) => left.getTime() - right.getTime())[0]
        ?.toISOString()
        .slice(0, 10) ?? null,
    prescription_end_date:
      latestIntake?.lines
        .map((line) => line.end_date)
        .filter((value): value is Date => value != null)
        .sort((left, right) => right.getTime() - left.getTime())[0]
        ?.toISOString()
        .slice(0, 10) ?? null,
  };
  const billingPaymentProfile = readJsonObject(billingPaymentProfileTask?.metadata);
  const canViewBillingDetails = hasPermission(ctx.role, 'canManageBilling');
  const billingCandidateCollections = billingCandidates.map((candidate) => {
    const collection = readBillingCollection(candidate.calculation_breakdown);
    const estimatedAmount = estimateBillingCandidateAmount(candidate);
    return {
      candidate,
      collection,
      estimatedAmount,
      outstandingAmount: resolveCollectionOutstandingAmount(collection, estimatedAmount),
    };
  });
  const currentBillingMonth = billingCandidateCollections[0]?.candidate.billing_month ?? null;
  const currentBillingRows = currentBillingMonth
    ? billingCandidateCollections.filter(
        (item) => item.candidate.billing_month.getTime() === currentBillingMonth.getTime(),
      )
    : [];
  const previousBillingRows = currentBillingMonth
    ? billingCandidateCollections.filter(
        (item) => item.candidate.billing_month.getTime() < currentBillingMonth.getTime(),
      )
    : [];
  const latestBilling = currentBillingRows[0] ?? null;
  const previousUnpaidAmount = previousBillingRows.reduce(
    (sum, item) => sum + Math.max(item.outstandingAmount ?? 0, 0),
    0,
  );
  const currentCollectionAmount = currentBillingRows.length
    ? currentBillingRows.reduce((sum, item) => sum + Math.max(item.outstandingAmount ?? 0, 0), 0)
    : null;
  const currentBilledAmount = currentBillingRows.length
    ? currentBillingRows.reduce((sum, item) => {
        const billedAmount = item.collection?.billed_amount ?? item.estimatedAmount ?? 0;
        return sum + Math.max(billedAmount, 0);
      }, 0)
    : null;
  const totalCollectionAmount =
    latestBilling || previousUnpaidAmount > 0
      ? (currentCollectionAmount ?? 0) + previousUnpaidAmount
      : null;
  const latestCollection = latestBilling?.collection ?? null;
  const fallbackPaymentMethod = readString(billingPaymentProfile?.payment_method);
  const collectionTiming = readString(billingPaymentProfile?.collection_timing);
  const collectionMethod =
    latestCollection?.payment_method ??
    fallbackPaymentMethod ??
    readString(intakeData?.collection_method) ??
    null;
  const receiptIssue = readString(billingPaymentProfile?.receipt_issue);
  const billingCollectionContext =
    latestBilling || billingPaymentProfile
      ? {
          candidate_id: latestBilling?.candidate.id ?? null,
          billing_month: latestBilling?.candidate.billing_month.toISOString() ?? null,
          billing_name: latestBilling?.candidate.billing_name ?? null,
          candidate_status: latestBilling?.candidate.status ?? null,
          current_billed_amount: currentBilledAmount,
          current_collection_amount: currentCollectionAmount,
          previous_unpaid_amount: previousUnpaidAmount,
          total_collection_amount: totalCollectionAmount,
          collected_amount: latestCollection?.collected_amount ?? null,
          payer_name: canViewBillingDetails
            ? (latestCollection?.payer_name ??
              readString(billingPaymentProfile?.payer_name) ??
              null)
            : null,
          payer_relation: canViewBillingDetails
            ? readString(billingPaymentProfile?.payer_relation)
            : null,
          collection_method: collectionMethod,
          collection_method_label: collectionMethod
            ? (BILLING_PAYMENT_METHOD_LABELS[collectionMethod] ?? collectionMethod)
            : null,
          collection_timing: collectionTiming,
          collection_timing_label: collectionTiming
            ? (BILLING_COLLECTION_TIMING_LABELS[collectionTiming] ?? collectionTiming)
            : null,
          scheduled_collection_at: latestCollection?.scheduled_collection_at ?? null,
          collected_at: latestCollection?.collected_at ?? null,
          receipt_issue: receiptIssue,
          receipt_issue_label: receiptIssue
            ? (BILLING_RECEIPT_ISSUE_LABELS[receiptIssue] ?? receiptIssue)
            : null,
          receipt_issue_status: latestCollection?.receipt_issue_status ?? null,
          receipt_issue_status_label: latestCollection?.receipt_issue_status
            ? (BILLING_DOCUMENT_ISSUE_STATUS_LABELS[latestCollection.receipt_issue_status] ??
              latestCollection.receipt_issue_status)
            : null,
          receipt_number: canViewBillingDetails ? (latestCollection?.receipt_number ?? null) : null,
          collector_user_id: canViewBillingDetails ? (latestCollection?.updated_by ?? null) : null,
        }
      : null;
  const currentFacilitySchedule: FacilityParallelSchedule = {
    id: schedule.id,
    route_order: schedule.route_order,
    schedule_status: schedule.schedule_status,
    medication_start_date: schedule.medication_start_date,
    medication_end_date: schedule.medication_end_date,
    preparation: schedule.preparation
      ? {
          medication_changes_reviewed: schedule.preparation.medication_changes_reviewed,
          carry_items_confirmed: schedule.preparation.carry_items_confirmed,
          previous_issues_reviewed: schedule.preparation.previous_issues_reviewed,
          route_confirmed: schedule.preparation.route_confirmed,
          offline_synced: schedule.preparation.offline_synced,
        }
      : null,
    visit_record: schedule.visit_record,
    case_: {
      patient: {
        id: schedule.case_.patient.id,
        name: schedule.case_.patient.name,
        name_kana: schedule.case_.patient.name_kana,
        birth_date: schedule.case_.patient.birth_date,
        gender: schedule.case_.patient.gender,
        residences: schedule.case_.patient.residences.map((residence) => ({
          address: residence.address,
          facility_id: residence.facility_id,
          facility_unit_id: residence.facility_unit_id,
          building_id: residence.building_id,
          unit_name: residence.unit_name,
        })),
      },
    },
  };
  const facilityParallelSchedules = [currentFacilitySchedule, ...sameFacilitySchedules].sort(
    (left, right) => (left.route_order ?? 9999) - (right.route_order ?? 9999),
  );
  const facilityParallelContext =
    facilityParallelSchedules.length > 1
      ? {
          batch_id: schedule.facility_batch_id,
          label:
            deriveVisitPlaceGroup(primaryResidence ?? null)?.label ??
            deriveFacilityLabel(primaryResidence ?? null),
          place_kind: deriveVisitPlaceGroup(primaryResidence ?? null)?.kind ?? null,
          site_name: schedule.site?.name ?? null,
          common_notes: facilityPacketMemoToDisplayText(schedule.facility_batch?.notes ?? null),
          current_schedule_id: schedule.id,
          patients: facilityParallelSchedules.map((item) => {
            const residence = item.case_.patient.residences[0] ?? null;
            return {
              schedule_id: item.id,
              patient_id: item.case_.patient.id,
              patient_name: item.case_.patient.name,
              patient_name_kana: item.case_.patient.name_kana,
              patient_birth_date: toDateString(item.case_.patient.birth_date),
              patient_gender: item.case_.patient.gender,
              unit_name: residence?.unit_name ?? null,
              route_order: item.route_order,
              schedule_status: item.schedule_status,
              medication_start_date: toDateString(item.medication_start_date),
              medication_end_date: toDateString(item.medication_end_date),
              preparation_blockers_count: countPreparationBlockers(item.preparation),
              visit_record_id: item.visit_record?.id ?? null,
              visit_outcome_status: item.visit_record?.outcome_status ?? null,
            };
          }),
        }
      : null;
  const conferenceContext = recentConferenceNotes.flatMap((note) => {
    if (!isVisitPreparationConferenceNoteType(note.note_type)) {
      return [];
    }
    const noteType = note.note_type;
    const sections = parseConferenceSections(note.structured_content);
    const actionItemsFromSections = readConferenceSectionBody(sections, [
      'agreed_actions',
      'action_summary',
    ])
      ?.split('\n')
      .map((line) => line.replace(/^[\s\-*・]+/, '').trim())
      .filter((line) => line.length > 0);

    return {
      id: note.id,
      note_type: noteType,
      title: note.title,
      conference_date: note.conference_date.toISOString(),
      participants: parseConferenceParticipants(note.participants).map((participant) => ({
        name: participant.name ?? null,
        role: participant.role ?? null,
      })),
      highlights: buildConferenceHighlights(noteType, sections),
      action_items: [
        ...parseConferenceActionItems(note.action_items),
        ...(actionItemsFromSections ?? []),
      ].slice(0, 5),
      sync_summary: parseConferenceSyncSummary(note.metadata),
    };
  });

  return success({
    data: {
      preparation,
      pack: {
        patient: {
          id: schedule.case_.patient.id,
          name: schedule.case_.patient.name,
          address: primaryResidence?.address ?? null,
        },
        visit: {
          id: schedule.id,
          scheduled_date: schedule.scheduled_date.toISOString(),
          time_window_start: schedule.time_window_start?.toISOString() ?? null,
          time_window_end: schedule.time_window_end?.toISOString() ?? null,
          visit_type: schedule.visit_type,
          schedule_status: schedule.schedule_status,
          priority: schedule.priority,
          confirmed_at: schedule.confirmed_at?.toISOString() ?? null,
        },
        site: schedule.site,
        handoff: {
          assignment_mode: schedule.assignment_mode,
          summary: [
            ...(schedule.assignment_mode === 'fallback' ? ['代替担当での訪問です'] : []),
            ...(schedule.escalation_reason ? [schedule.escalation_reason] : []),
            ...(schedule.override_request?.status === 'pending'
              ? [`変更承認待ち: ${schedule.override_request.reason}`]
              : []),
            ...(schedule.applied_override
              ? [`例外変更理由: ${schedule.applied_override.reason}`]
              : []),
          ].join(' / '),
        },
        readiness_blockers: readinessBlockers,
        previous_visit: previousVisit
          ? {
              id: previousVisit.id,
              visit_date: previousVisit.visit_date.toISOString(),
              outcome_status: previousVisit.outcome_status,
              soap_plan: previousVisit.soap_plan,
              next_visit_suggestion_date:
                previousVisit.next_visit_suggestion_date?.toISOString() ?? null,
              source_revision: {
                version: previousVisit.version,
                updated_at: previousVisit.updated_at.toISOString(),
              },
              summary: buildPreviousVisitSummary(previousVisit),
              structured_reuse: buildPreviousStructuredVisitReuse(previousVisit),
            }
          : null,
        open_tasks: openTasks.map((task) => {
          const detail = describeOperationalTask(task);
          return {
            id: task.id,
            task_type: task.task_type,
            title: task.title,
            description: task.description,
            priority: task.priority,
            due_at: task.sla_due_at?.toISOString() ?? task.due_date?.toISOString() ?? null,
            action_href: detail.actionHref,
            action_label: detail.actionLabel,
          };
        }),
        recent_contact_logs: recentContactLogs.map((log) => ({
          outcome: log.outcome,
          contact_method: log.contact_method,
          has_note: Boolean(log.note?.trim()),
          callback_due_at: log.callback_due_at?.toISOString() ?? null,
          called_at: log.called_at.toISOString(),
        })),
        facility_mode: {
          label: deriveFacilityLabel(primaryResidence ?? null),
          same_day_patient_count: sameFacilitySchedules.length + 1,
          same_day_patient_names: [
            schedule.case_.patient.name,
            ...sameFacilitySchedules.map((item) => item.case_.patient.name),
          ],
          route_orders: [...sameDaySchedules.map((item) => item.route_order)].filter(
            (value): value is number => typeof value === 'number',
          ),
        },
        facility_parallel_context: facilityParallelContext,
        workload: {
          same_day_visit_count: sameDaySchedules.length + 1,
        },
        care_team: schedule.case_.care_team_links,
        conference_context: conferenceContext,
        billing_blockers: billingEvidence.flatMap((item) =>
          item.blockers.map((blocker) => ({
            evidence_id: item.id,
            visit_record_id: item.visit_record_id,
            ...blocker,
          })),
        ),
        billing_collection_context: billingCollectionContext,
        prescription_changes: prescriptionChanges,
        outside_meds: outsideMeds,
        medication_period: medicationPeriod,
        home_care_feature_highlights:
          selectScheduleHomeCareFeatureHighlights(homeCareFeatureSummary),
        jahis_supplemental_records: visitBrief.jahis_supplemental_records,
        visit_brief: visitBrief,
        onboarding_readiness,
        intake_context,
        emergency_contacts: patient.contacts ?? [],
        first_visit_document: firstVisitDoc
          ? {
              delivered_at: firstVisitDoc.delivered_at?.toISOString() ?? null,
              delivered_to: firstVisitDoc.delivered_to ?? null,
            }
          : null,
      },
    },
  });
}

export async function GET(
  req: NextRequest,
  routeContext: { params: Promise<{ scheduleId: string }> },
) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedPUT(
  req: NextRequest,
  { params }: { params: Promise<{ scheduleId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問準備情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { scheduleId } = await params;
  const normalizedScheduleId = normalizeRequiredRouteParam(scheduleId);
  if (!normalizedScheduleId) return validationError('訪問予定IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = upsertVisitPreparationSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const schedule = await prisma.visitSchedule.findFirst({
    where: {
      id: normalizedScheduleId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
      case_id: true,
      site_id: true,
      vehicle_resource_id: true,
      carry_items_status: true,
      schedule_status: true,
      confirmed_at: true,
      scheduled_date: true,
      route_order: true,
      pharmacist_id: true,
      version: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  });
  if (!schedule) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, schedule)) {
    return forbiddenResponse('この訪問予定の準備情報を更新する権限がありません');
  }

  const readinessBlockers = buildVisitReadyReadinessBlockers(
    parsed.data,
    schedule.carry_items_status,
  );
  const preparationReady = readinessBlockers.length === 0;
  if (parsed.data.mark_ready && !preparationReady) {
    const details = {
      readiness_blockers: readinessBlockers,
      onboarding_blockers: [],
      billing_blockers: [],
    } satisfies VisitReadyTransitionBlockers;
    return validationError(
      getVisitReadyTransitionErrorMessage(details),
      sanitizeVisitReadyTransitionDetails(details),
    );
  }
  if (
    parsed.data.mark_ready &&
    !MARK_READY_SOURCE_STATUSES.has(schedule.schedule_status) &&
    !MARK_READY_SATISFIED_STATUSES.has(schedule.schedule_status)
  ) {
    return validationError('この訪問予定は ready へ進められません');
  }
  const shouldAdvanceScheduleToReady =
    parsed.data.mark_ready && !MARK_READY_SATISFIED_STATUSES.has(schedule.schedule_status);

  const templateOpts = parsed.data.template_options;
  const effectiveChecklist: Record<string, unknown> = templateOpts
    ? mergeChecklistWithTemplate(parsed.data.checklist, {
        narcoticsCarry: templateOpts.narcotics_carry,
        infectionControl: templateOpts.infection_control,
        coldChainRequired: templateOpts.cold_chain_required,
        facilityCustomItems: templateOpts.facility_custom_items,
      })
    : Object.keys(parsed.data.checklist).length === 0
      ? buildChecklistFromTemplate()
      : parsed.data.checklist;
  const normalizedChecklist = normalizeInputJsonObject(effectiveChecklist);
  const submittedRoutePlanSnapshot = parsed.data.route_plan_snapshot
    ? normalizeInputJsonObject(parsed.data.route_plan_snapshot)
    : null;
  const routeVehicleResourceId = parsed.data.route_confirmed
    ? (readRouteSnapshotVehicleResourceId(submittedRoutePlanSnapshot) ??
      schedule.vehicle_resource_id)
    : null;
  let routePlanSnapshotWriteValue: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;

  if (parsed.data.route_confirmed) {
    const { start, end } = buildVisitDayRange(schedule.scheduled_date);
    const [vehicleResource, routeCellSchedules] = await Promise.all([
      routeVehicleResourceId
        ? prisma.visitVehicleResource.findFirst({
            where: {
              org_id: ctx.orgId,
              id: routeVehicleResourceId,
              available: true,
            },
            select: {
              id: true,
              site_id: true,
              label: true,
              travel_mode: true,
              max_stops: true,
              max_route_duration_minutes: true,
            },
          })
        : Promise.resolve(null),
      prisma.visitSchedule.findMany({
        where: schedule.pharmacist_id
          ? {
              org_id: ctx.orgId,
              pharmacist_id: schedule.pharmacist_id,
              scheduled_date: {
                gte: start,
                lt: end,
              },
              schedule_status: {
                notIn: ['cancelled', 'rescheduled'],
              },
              ...(schedule.site_id ? { site_id: schedule.site_id } : {}),
            }
          : {
              org_id: ctx.orgId,
              id: schedule.id,
            },
        orderBy: [{ route_order: 'asc' }, { time_window_start: 'asc' }, { created_at: 'asc' }],
        select: {
          id: true,
          route_order: true,
          priority: true,
          time_window_start: true,
          time_window_end: true,
          site: {
            select: {
              id: true,
              name: true,
              lat: true,
              lng: true,
            },
          },
          case_: {
            select: {
              patient: {
                select: {
                  name: true,
                  residences: {
                    where: { is_primary: true },
                    select: {
                      address: true,
                      lat: true,
                      lng: true,
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    if (routeVehicleResourceId && !vehicleResource) {
      return validationError('選択した車両リソースが見つからないか利用できません');
    }
    if (vehicleResource && schedule.site_id && vehicleResource.site_id !== schedule.site_id) {
      return validationError('選択した車両リソースは訪問予定の拠点では利用できません');
    }
    const currentScheduleInRoute = routeCellSchedules.some((item) => item.id === schedule.id);
    const orderedRouteCellSchedules = currentScheduleInRoute
      ? routeCellSchedules
      : [
          ...routeCellSchedules,
          ...(await prisma.visitSchedule.findMany({
            where: {
              org_id: ctx.orgId,
              id: schedule.id,
            },
            select: {
              id: true,
              route_order: true,
              priority: true,
              time_window_start: true,
              time_window_end: true,
              site: {
                select: {
                  id: true,
                  name: true,
                  lat: true,
                  lng: true,
                },
              },
              case_: {
                select: {
                  patient: {
                    select: {
                      name: true,
                      residences: {
                        where: { is_primary: true },
                        select: {
                          address: true,
                          lat: true,
                          lng: true,
                        },
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          })),
        ];
    if (
      vehicleResource?.max_stops != null &&
      orderedRouteCellSchedules.length > vehicleResource.max_stops
    ) {
      return validationError(
        `${vehicleResource.label} で訪問できる件数は最大 ${vehicleResource.max_stops} 件です`,
      );
    }
    const originSite = orderedRouteCellSchedules[0]?.site ?? null;
    const origin =
      originSite?.lat != null && originSite.lng != null
        ? {
            lat: originSite.lat,
            lng: originSite.lng,
            label: originSite.name,
          }
        : null;
    const routableSchedules = orderedRouteCellSchedules.filter(
      (item) =>
        item.case_.patient.residences[0]?.lat != null &&
        item.case_.patient.residences[0]?.lng != null,
    );
    const routePlan = await computeOptimizedVisitRoute({
      origin,
      travelMode:
        vehicleResource?.travel_mode ??
        readRouteSnapshotTravelMode(submittedRoutePlanSnapshot) ??
        'DRIVE',
      waypoints: routableSchedules.map((item) => {
        const residence = item.case_.patient.residences[0]!;
        return {
          scheduleId: item.id,
          patientName: item.case_.patient.name,
          address: residence.address,
          lat: residence.lat!,
          lng: residence.lng!,
          priority: item.priority,
          timeWindow: visitRouteTimeWindowFromDbTime(item.time_window_start, item.time_window_end),
          serviceMinutes: DEFAULT_VISIT_ROUTE_SERVICE_MINUTES,
        };
      }),
    });
    const missingCoordinateCount = orderedRouteCellSchedules.filter(
      (item) => !routableSchedules.some((candidate) => candidate.id === item.id),
    ).length;
    const routePlanWithCellNotes =
      missingCoordinateCount > 0
        ? {
            ...routePlan,
            note: appendRouteNote(routePlan.note, `座標未設定: ${missingCoordinateCount}件`),
          }
        : routePlan;
    const generatedSnapshot = normalizeRoutePlanSnapshotForWrite(routePlanWithCellNotes, {
      scheduleIds: orderedRouteCellSchedules.map((item) => item.id),
      routeOrder: schedule.route_order,
      vehicleResource: vehicleResource
        ? {
            id: vehicleResource.id,
            label: vehicleResource.label,
            max_stops: vehicleResource.max_stops,
            max_route_duration_minutes: vehicleResource.max_route_duration_minutes,
          }
        : null,
      generatedAt: new Date(),
    });
    const generatedVehicleStatus = readJsonObject(
      generatedSnapshot.vehicle_resource,
    )?.constraint_status;
    if (generatedVehicleStatus === 'exceeded') {
      return validationError('選択した車両リソースの稼働上限を超えるためルート確認できません');
    }
    routePlanSnapshotWriteValue = generatedSnapshot;
  }

  let result;
  try {
    result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const preparation = await tx.visitPreparation.upsert({
          where: {
            schedule_id: schedule.id,
          },
          create: {
            org_id: ctx.orgId,
            schedule_id: schedule.id,
            checklist: normalizedChecklist,
            medication_changes_reviewed: parsed.data.medication_changes_reviewed,
            carry_items_confirmed: parsed.data.carry_items_confirmed,
            previous_issues_reviewed: parsed.data.previous_issues_reviewed,
            route_confirmed: parsed.data.route_confirmed,
            route_plan_snapshot: routePlanSnapshotWriteValue,
            offline_synced: parsed.data.offline_synced,
            prepared_by: ctx.userId,
            prepared_at: preparationReady ? new Date() : null,
          },
          update: {
            checklist: normalizedChecklist,
            medication_changes_reviewed: parsed.data.medication_changes_reviewed,
            carry_items_confirmed: parsed.data.carry_items_confirmed,
            previous_issues_reviewed: parsed.data.previous_issues_reviewed,
            route_confirmed: parsed.data.route_confirmed,
            route_plan_snapshot: routePlanSnapshotWriteValue,
            offline_synced: parsed.data.offline_synced,
            prepared_by: ctx.userId,
            prepared_at: preparationReady ? new Date() : null,
          },
        });

        if (shouldAdvanceScheduleToReady) {
          const readyTransition = await evaluateVisitScheduleReadyTransition(tx, {
            orgId: ctx.orgId,
            scheduleId: schedule.id,
          });
          if (!readyTransition.ok) {
            throw new VisitPreparationReadyTransitionError(readyTransition.details);
          }
        }

        if (shouldAdvanceScheduleToReady) {
          const updated = await tx.visitSchedule.updateMany({
            where: {
              id: schedule.id,
              org_id: ctx.orgId,
              version: schedule.version,
              confirmed_at: schedule.confirmed_at,
              pharmacist_id: schedule.pharmacist_id,
              scheduled_date: schedule.scheduled_date,
              schedule_status: schedule.schedule_status,
            },
            data: {
              ...(routeVehicleResourceId ? { vehicle_resource_id: routeVehicleResourceId } : {}),
              schedule_status: 'ready',
              pre_visit_checklist_completed: true,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw new VisitPreparationScheduleConflictError();
          }
        } else if (routeVehicleResourceId) {
          await tx.visitSchedule.update({
            where: { id: schedule.id },
            data: {
              vehicle_resource_id: routeVehicleResourceId,
              version: { increment: 1 },
            },
          });
        }

        if (preparationReady) {
          await resolveOperationalTasks(tx, {
            orgId: ctx.orgId,
            dedupeKey: buildPreparationTaskKey(schedule.id),
            status: 'completed',
          });
        } else {
          await upsertOperationalTask(tx, {
            orgId: ctx.orgId,
            taskType: 'visit_preparation',
            title: '訪問準備が未完了です',
            description: `未完了: ${readinessBlockers.join('、')}`,
            priority: 'high',
            assignedTo: schedule.pharmacist_id,
            dueDate: schedule.scheduled_date,
            slaDueAt: schedule.scheduled_date,
            relatedEntityType: 'visit_schedule',
            relatedEntityId: schedule.id,
            dedupeKey: buildPreparationTaskKey(schedule.id),
          });
        }

        return preparation;
      },
      { requestContext: ctx },
    );
  } catch (cause) {
    if (cause instanceof VisitPreparationReadyTransitionError) {
      return validationError(cause.message, sanitizeVisitReadyTransitionDetails(cause.details));
    }
    if (cause instanceof VisitPreparationScheduleConflictError) {
      return conflict(cause.message);
    }
    throw cause;
  }

  return success({ data: result });
}

export async function PUT(
  req: NextRequest,
  routeContext: { params: Promise<{ scheduleId: string }> },
) {
  try {
    return withSensitiveNoStore(await authenticatedPUT(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
