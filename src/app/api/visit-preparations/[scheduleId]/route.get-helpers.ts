import { Prisma } from '@prisma/client';
import { formatNullableDateKey } from '@/lib/date-key';
import { readJsonObject } from '@/lib/db/json';
import { matchMedicationDiffLines } from '@/lib/prescription/medication-diff';

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
export type FacilityParallelSchedule = {
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

export const BILLING_PAYMENT_PROFILE_TASK_TYPE = 'patient_billing_payment_profile';

export const BILLING_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: '現金',
  bank_transfer: '振込',
  bank_debit: '口座振替',
  credit_card: 'クレカ',
  facility_billing: '施設請求',
  corporate_billing: '法人請求',
  other: 'その他',
};

export const BILLING_COLLECTION_TIMING_LABELS: Record<string, string> = {
  per_visit: '毎回',
  month_end: '月末',
  next_month: '翌月',
  facility_batch: '施設一括',
  other: 'その他',
};

export const BILLING_RECEIPT_ISSUE_LABELS: Record<string, string> = {
  paper: '紙',
  pdf: 'PDF',
  none: '不要',
};

export const BILLING_DOCUMENT_ISSUE_STATUS_LABELS: Record<string, string> = {
  not_required: '不要',
  not_issued: '未発行',
  issued: '発行済',
};

const VISIT_PREPARATION_CONFERENCE_NOTE_TYPES = new Set(['pre_discharge', 'service_manager']);
type VisitPreparationConferenceNoteType = 'pre_discharge' | 'service_manager';

export function isVisitPreparationConferenceNoteType(
  value: string,
): value is VisitPreparationConferenceNoteType {
  return VISIT_PREPARATION_CONFERENCE_NOTE_TYPES.has(value);
}

export function summarizePrescriptionChanges(
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

export function toDateString(value: Date | null | undefined) {
  return formatNullableDateKey(value);
}

export function countPreparationBlockers(preparation: FacilityParallelSchedule['preparation']) {
  return [
    !preparation?.medication_changes_reviewed,
    !preparation?.carry_items_confirmed,
    !preparation?.previous_issues_reviewed,
    !preparation?.route_confirmed,
    !preparation?.offline_synced,
  ].filter(Boolean).length;
}

export function buildPreviousVisitSummary(
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

export function buildPreviousStructuredVisitReuse(
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
    ...handoffOngoingMonitoring.map((item) => `継続観察: ${item}`),
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
export function parseConferenceSections(
  value: Prisma.JsonValue | null,
): ConferenceSectionSummary[] {
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

export function parseConferenceParticipants(
  value: Prisma.JsonValue,
): ConferenceParticipantSummary[] {
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

export function parseConferenceActionItems(value: Prisma.JsonValue | null): string[] {
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

export function readConferenceSectionBody(sections: ConferenceSectionSummary[], keys: string[]) {
  for (const key of keys) {
    const body = sections.find((section) => section.key === key)?.body?.trim();
    if (body) return body;
  }
  return null;
}

export function parseConferenceSyncSummary(
  value: Prisma.JsonValue | null,
): ConferenceSyncSummary | null {
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

export function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readBillingCollection(
  calculationBreakdown: unknown,
): BillingCollectionSnapshot | null {
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

export function estimateBillingCandidateAmount(candidate: {
  points: number | null;
  calculation_breakdown: Prisma.JsonValue | null;
}) {
  const breakdown = readJsonObject(candidate.calculation_breakdown);
  return readNumber(breakdown?.amount_yen) ?? candidate.points ?? null;
}

export function resolveCollectionOutstandingAmount(
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

export function buildConferenceHighlights(
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
