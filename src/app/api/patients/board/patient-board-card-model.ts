import { formatUtcDateKey } from '@/lib/date-key';
import { getProcessStepKeyForStatus } from '@/lib/prescription/cycle-workspace';
import {
  buildCareTeamReliabilitySummary,
  buildPatientContactReadiness,
  selectPrimaryCareTeamCase,
} from '@/lib/patient/care-team-contact';
import { careLevelLabels } from '@/lib/patient/home-visit-intake';
import { buildPatientHref } from '@/lib/patient/navigation';
import { sortPatientSafetyTags } from '@/lib/patient/safety-tags';
import { derivePatientWorkflowState } from '@/lib/patient/patient-workflow-state';
import { isVisitCarryItemsStatusBlockingReady } from '@/server/services/visit-preparation-readiness';
import { buildPatientFoundationSummary } from '@/server/services/patient-detail-foundation';
import { japanDateKey } from '@/lib/utils/date-boundary';
import { timeDateToString } from '@/lib/visits/time-of-day';
import type {
  PatientAttentionKey,
  PatientBoardCard,
  PatientFoundationIssueKey,
} from '@/types/patient-board';

/** 「対応が必要な順」のソート優先度。 */
const ATTENTION_PRIORITY: Record<PatientAttentionKey, number> = {
  urgent_now: 0,
  wait_release: 1,
  acceptance: 2,
  visit_today: 3,
  external_wait: 4,
  checking: 5,
  reply_wait: 6,
  steady: 7,
  paused: 8,
};

const FOUNDATION_STATUS_PRIORITY: Record<
  NonNullable<PatientBoardCard['foundation_summary']>['status'],
  number
> = {
  missing: 0,
  needs_confirmation: 1,
  ready: 2,
};

export type PatientBoardQueryRow = {
  id: string;
  name: string;
  name_kana: string | null;
  birth_date: Date;
  medical_insurance_number: string | null;
  care_insurance_number: string | null;
  allergy_info: unknown;
  scheduling_preference: {
    swallowing_route: string | null;
    preferred_contact_name: string | null;
    preferred_contact_phone: string | null;
    visit_before_contact_required: boolean | null;
    parking_available: boolean | null;
    care_level: string | null;
  } | null;
  contacts: Array<{
    is_primary: boolean | null;
    is_emergency_contact: boolean | null;
    phone: string | null;
    email: string | null;
    fax: string | null;
  }>;
  residences: Array<{
    facility_id: string | null;
    building_id: string | null;
  }>;
  lab_observations: Array<{ id: string }>;
  consents: Array<{ id: string }>;
  cases: Array<{
    id: string;
    status: string;
    management_plans: Array<{
      id: string;
      next_review_date: Date | null;
    }>;
    care_team_links: Array<{
      role: string;
      phone: string | null;
      email: string | null;
      fax: string | null;
      is_primary: boolean | null;
    }>;
    care_reports?: Array<{
      id: string;
      status: string;
    }>;
    medication_cycles: Array<{
      id: string;
      overall_status: string;
      exception_status: string | null;
      updated_at: Date;
      prescription_intakes: Array<{
        lines: Array<{
          packaging_instruction_tags: string[];
          dispensing_method: string | null;
        }>;
      }>;
      inquiries: Array<{ inquired_at: Date; resolved_at: Date | null }>;
      dispense_tasks: Array<{
        due_date: Date | null;
        audits: Array<{ result: string }>;
      }>;
      workflow_exceptions: Array<{
        exception_type: string;
        description: string;
        created_at: Date;
      }>;
    }>;
    visit_schedules: Array<{
      id: string;
      scheduled_date: Date;
      time_window_start: Date | null;
      carry_items_status: string | null;
      facility_batch_id: string | null;
      facility_batch: { patient_ids: unknown } | null;
      preparation: {
        prepared_at: Date | null;
        medication_changes_reviewed: boolean;
        carry_items_confirmed: boolean;
        previous_issues_reviewed: boolean;
        route_confirmed: boolean;
        offline_synced: boolean;
      } | null;
    }>;
  }>;
};

export type DerivedPatientBoardCard = PatientBoardCard & {
  facility_batch_id: string | null;
  facility_batch_patient_count: number;
};

export type PatientBoardFoundationIssueFilter =
  | PatientFoundationIssueKey
  | 'needs_confirmation'
  | undefined;

type NextVisitSchedule = PatientBoardQueryRow['cases'][number]['visit_schedules'][number] | null;

function parseDateKeyParts(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) throw new RangeError(`Invalid date key: ${dateKey}`);
  return { year, month, day };
}

function calculateAge(birthDate: Date, now: Date): number {
  const birth = parseDateKeyParts(formatUtcDateKey(birthDate));
  const today = parseDateKeyParts(japanDateKey(now));
  let age = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) {
    age -= 1;
  }
  return Math.max(0, age);
}

/** allergy_info(Json)が「アレルギーあり」を表すか。空配列/空文字/None 表記は除外。 */
function hasAllergyInfo(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && !['なし', 'none', '無し'].includes(trimmed.toLowerCase());
  }
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function buildOperationSummary(
  patient: PatientBoardQueryRow,
  args: {
    visitToday: boolean;
    visitPrepared: boolean;
    facilityBatchPatientCount: number;
    contactReady: boolean;
  },
): string[] {
  const preference = patient.scheduling_preference;
  const parking =
    preference?.parking_available === true
      ? '駐車場あり'
      : preference?.parking_available === false
        ? '駐車場なし'
        : '駐車未確認';
  const careLevel = preference?.care_level
    ? (careLevelLabels[preference.care_level] ?? preference.care_level)
    : null;

  const visitLabels = args.visitToday
    ? [
        args.facilityBatchPatientCount > 0 ? `施設一括${args.facilityBatchPatientCount}名` : null,
        args.visitPrepared ? '訪問準備済' : '準備未完',
      ]
    : [];

  return [...visitLabels, args.contactReady ? '連絡先あり' : '連絡先未設定', parking, careLevel]
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
}

function isVisitPreparationDisplayReady(schedule: NextVisitSchedule): boolean {
  const preparation = schedule?.preparation;
  return Boolean(
    preparation?.prepared_at &&
    preparation.medication_changes_reviewed &&
    preparation.carry_items_confirmed &&
    preparation.previous_issues_reviewed &&
    preparation.route_confirmed &&
    preparation.offline_synced &&
    !isVisitCarryItemsStatusBlockingReady(schedule?.carry_items_status),
  );
}

function isManagementPlanReviewOverdue(nextReviewDate: Date | null, todayKey: string): boolean {
  return Boolean(nextReviewDate && formatUtcDateKey(nextReviewDate) < todayKey);
}

/** 1 患者 → 患者カード(状態語彙・危険タグ・工程・自然文)導出。 */
export function derivePatientBoardCard(
  patient: PatientBoardQueryRow,
  now: Date,
): DerivedPatientBoardCard {
  const todayKey = japanDateKey(now);

  const careCase = selectPrimaryCareTeamCase(patient.cases);
  const cycle = careCase?.medication_cycles[0] ?? null;
  const pendingReport = careCase?.care_reports?.[0] ?? null;
  const nextSchedule = careCase?.visit_schedules[0] ?? null;
  const openException = cycle?.workflow_exceptions[0] ?? null;
  const latestInquiry = cycle?.inquiries[0] ?? null;
  const auditTask = cycle?.dispense_tasks[0] ?? null;
  const latestAuditResult = auditTask?.audits[0]?.result ?? null;
  const auditWaiting =
    cycle != null &&
    ['dispensed', 'audit_pending'].includes(cycle.overall_status) &&
    (latestAuditResult == null || latestAuditResult === 'hold');

  const tagSet = new Set<string>();
  for (const line of cycle?.prescription_intakes[0]?.lines ?? []) {
    for (const tag of line.packaging_instruction_tags) tagSet.add(tag);
    if (line.dispensing_method === 'unit_dose') tagSet.add('unit_dose');
  }
  if (patient.lab_observations.length > 0) tagSet.add('renal');
  if (patient.scheduling_preference?.swallowing_route?.trim()) tagSet.add('swallowing');
  if (hasAllergyInfo(patient.allergy_info)) tagSet.add('allergy');
  const safetyTags = sortPatientSafetyTags(tagSet);

  const hospitalized =
    cycle?.exception_status === 'hospitalized' || openException?.exception_type === 'hospitalized';
  const isFacility = Boolean(
    patient.residences[0]?.facility_id || patient.residences[0]?.building_id,
  );
  const residenceKind = hospitalized ? 'hospital' : isFacility ? 'facility' : 'home';
  const residenceLabel = hospitalized ? '入院中' : isFacility ? '施設' : '在宅';

  const hasNarcotic = tagSet.has('narcotic');
  const visitToday =
    nextSchedule != null && formatUtcDateKey(nextSchedule.scheduled_date) === todayKey;
  const visitPreparationReady = isVisitPreparationDisplayReady(nextSchedule);

  const currentStep = cycle ? getProcessStepKeyForStatus(cycle.overall_status) : null;

  const workflowState = derivePatientWorkflowState({
    patientId: patient.id,
    hasCareCase: careCase != null,
    careCaseStatus: careCase?.status ?? null,
    currentStep,
    cycleOverallStatus: cycle?.overall_status ?? null,
    cycleExceptionStatus: cycle?.exception_status ?? null,
    cycleUpdatedAt: cycle?.updated_at ?? null,
    hospitalized,
    auditWaiting,
    hasNarcotic,
    auditDueDate: auditTask?.due_date ?? null,
    inquiryResolvedAt: latestInquiry?.resolved_at ?? null,
    inquiryInquiredAt: latestInquiry?.inquired_at ?? null,
    visitToday,
    visitPreparationReady,
    nextScheduleId: nextSchedule?.id ?? null,
    pendingReportId: pendingReport?.id ?? null,
    openExceptionType: openException?.exception_type ?? null,
    now,
  });

  const patientHref = buildPatientHref(patient.id);
  const resolvedLink = workflowState.link ?? { label: 'カードへ', href: patientHref };
  const linkHref = resolvedLink.href.length > 0 ? resolvedLink.href : patientHref;

  const batchPatientIds = nextSchedule?.facility_batch?.patient_ids;
  const facilityBatchPatientCount = Array.isArray(batchPatientIds) ? batchPatientIds.length : 0;
  const preference = patient.scheduling_preference;
  const contactReadiness = buildPatientContactReadiness({
    contacts: patient.contacts,
    preferredContactName: preference?.preferred_contact_name,
    preferredContactPhone: preference?.preferred_contact_phone,
    visitBeforeContactRequired: preference?.visit_before_contact_required,
  });
  const careTeamReliability = buildCareTeamReliabilitySummary({
    contacts: patient.contacts,
    careTeamLinks: careCase?.care_team_links ?? [],
  });
  const hasActiveVisitConsent = patient.consents.length > 0;
  const currentManagementPlan = careCase?.management_plans[0] ?? null;
  const consentPlanMissing =
    !hasActiveVisitConsent ||
    !currentManagementPlan ||
    isManagementPlanReviewOverdue(currentManagementPlan.next_review_date, todayKey);
  const insuranceMissing = !patient.medical_insurance_number && !patient.care_insurance_number;
  const foundationIssueKeys: PatientFoundationIssueKey[] = [
    contactReadiness.ready ? null : 'missing_contact',
    consentPlanMissing ? 'missing_consent_plan' : null,
    preference?.parking_available == null ? 'missing_parking' : null,
    preference?.care_level ? null : 'missing_care_level',
    insuranceMissing ? 'missing_insurance' : null,
    careTeamReliability.alert_count > 0 ? 'missing_care_team' : null,
  ].filter((key): key is PatientFoundationIssueKey => Boolean(key));

  const operationSummary = buildOperationSummary(patient, {
    visitToday,
    visitPrepared: visitPreparationReady,
    facilityBatchPatientCount,
    contactReady: contactReadiness.ready,
  });
  const foundationSummary = buildPatientFoundationSummary({
    hasPreferredContact: contactReadiness.ready,
    parkingAvailable: preference?.parking_available,
    careLevel: preference?.care_level,
    visitToday,
    visitPrepared: visitPreparationReady,
    safetyTagCount: safetyTags.length,
    insuranceAlertCount: insuranceMissing ? 1 : 0,
    careTeamReliabilityAlertCount: careTeamReliability.alert_count,
    consentPlanAlertCount: consentPlanMissing ? 1 : 0,
  });

  return {
    patient_id: patient.id,
    name: patient.name,
    age: calculateAge(patient.birth_date, now),
    residence_kind: residenceKind,
    residence_label: residenceLabel,
    attention: workflowState.attention,
    safety_tags: safetyTags,
    next_visit_date: nextSchedule ? formatUtcDateKey(nextSchedule.scheduled_date) : null,
    next_visit_time: nextSchedule?.time_window_start
      ? (timeDateToString(nextSchedule.time_window_start) ?? null)
      : null,
    next_visit_label: nextSchedule ? null : workflowState.nextVisitLabel,
    current_step: workflowState.currentStep,
    status_text: workflowState.statusText,
    status_tone: workflowState.statusTone,
    operation_summary: operationSummary,
    foundation_summary: foundationSummary,
    foundation_issue_keys: foundationIssueKeys,
    foundation_href: `${patientHref}#patient-foundation`,
    link_label: resolvedLink.label,
    link_href: linkHref,
    facility_batch_id: visitToday ? (nextSchedule?.facility_batch_id ?? null) : null,
    facility_batch_patient_count: visitToday ? facilityBatchPatientCount : 0,
  };
}

export function comparePatientBoardCards(
  left: DerivedPatientBoardCard,
  right: DerivedPatientBoardCard,
): number {
  const priorityDiff = ATTENTION_PRIORITY[left.attention] - ATTENTION_PRIORITY[right.attention];
  if (priorityDiff !== 0) return priorityDiff;
  const foundationDiff =
    FOUNDATION_STATUS_PRIORITY[left.foundation_summary?.status ?? 'ready'] -
    FOUNDATION_STATUS_PRIORITY[right.foundation_summary?.status ?? 'ready'];
  if (foundationDiff !== 0) return foundationDiff;
  const leftDate = left.next_visit_date ?? '9999-99-99';
  const rightDate = right.next_visit_date ?? '9999-99-99';
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  return left.name.localeCompare(right.name, 'ja');
}

export function matchesPatientBoardFoundationIssue(
  card: DerivedPatientBoardCard,
  issue: PatientBoardFoundationIssueFilter,
) {
  if (!issue) return true;
  if (issue === 'needs_confirmation') return card.foundation_summary?.status !== 'ready';
  return card.foundation_issue_keys?.includes(issue) ?? false;
}

function countDerivedCards(
  cards: DerivedPatientBoardCard[],
  predicate: (card: DerivedPatientBoardCard) => boolean,
): number {
  return cards.reduce((count, card) => count + (predicate(card) ? 1 : 0), 0);
}

export function buildPatientBoardFoundationIssueCounts(cards: DerivedPatientBoardCard[]) {
  return {
    needs_confirmation: countDerivedCards(
      cards,
      (card) => card.foundation_summary?.status !== 'ready',
    ),
    missing_contact: countDerivedCards(cards, (card) =>
      Boolean(card.foundation_issue_keys?.includes('missing_contact')),
    ),
    missing_consent_plan: countDerivedCards(cards, (card) =>
      Boolean(card.foundation_issue_keys?.includes('missing_consent_plan')),
    ),
    missing_parking: countDerivedCards(cards, (card) =>
      Boolean(card.foundation_issue_keys?.includes('missing_parking')),
    ),
    missing_care_level: countDerivedCards(cards, (card) =>
      Boolean(card.foundation_issue_keys?.includes('missing_care_level')),
    ),
    missing_insurance: countDerivedCards(cards, (card) =>
      Boolean(card.foundation_issue_keys?.includes('missing_insurance')),
    ),
    missing_care_team: countDerivedCards(cards, (card) =>
      Boolean(card.foundation_issue_keys?.includes('missing_care_team')),
    ),
  };
}
