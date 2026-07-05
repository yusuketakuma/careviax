import type { BillingEvidenceBlocker } from '@/server/services/billing-evidence/core';
import {
  VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER,
  VISIT_READY_PREPARATION_ITEMS,
  type VisitReadyOnboardingBlocker,
  type VisitReadyPreparationChecklist,
  type VisitReadyTransitionBlockers,
} from '@/server/services/visit-preparation-readiness';
import type { PatientFoundationItem } from '@/server/services/patient-detail-foundation';
import { buildDispenseTaskHref } from '@/lib/dispense/navigation';
import { describeOperationalTask } from '@/lib/tasks/operational-task-presentation';
import { findActivePatientShareConsent } from '@/server/services/pharmacy-partnerships';
import { enabledPatientShareScopeKeys } from '@/server/services/patient-share-scope';
import {
  buildRiskDedupeKey,
  createRiskFinding,
  type RiskDomain,
  type RiskFinding,
  type RiskSeverity,
} from '@/lib/risk/risk-finding';
import { japanDateKey } from '@/lib/utils/date-boundary';

export type RiskFindingAdapterContext = {
  patientId?: string | null;
  caseId?: string | null;
  scheduleId?: string | null;
  visitRecordId?: string | null;
  billingEvidenceId?: string | null;
  patientHref?: string | null;
  dueAt?: string | null;
};

export type OperationalTaskRiskInput = {
  id: string;
  task_type: string;
  title?: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: string;
  assigned_to?: string | null;
  due_date?: Date | string | null;
  sla_due_at?: Date | string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

export type CareReportRiskInput = {
  id: string;
  status: string;
};

export type VisitPreparationRiskInput = {
  id: string;
  scheduled_date: Date | string;
  carry_items_status: string | null;
  preparation: {
    id: string;
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
  } | null;
};

export type ConsentPlanRiskInput = {
  consent: {
    id: string;
    expiry_date?: Date | string | null;
  } | null;
  managementPlan: {
    id: string;
    next_review_date?: Date | string | null;
  } | null;
  firstVisitDocument: {
    id: string;
    delivered_at?: Date | string | null;
  } | null;
  now: Date | string;
};

export type DispenseTaskRiskInput = {
  id: string;
  priority: string | null;
  status: string;
  assigned_to?: string | null;
  due_date?: Date | string | null;
};

export type PrescriptionLineReconciliationRiskInput = {
  id: string;
  drug_master_id?: string | null;
  drug_resolution_status?: string | null;
};

export type NotificationRiskInput = {
  id: string;
  type: string;
  event_type?: string | null;
  link?: string | null;
  created_at?: Date | string | null;
};

export type ResidenceGeocodeRiskInput = {
  id: string;
  lat?: number | null;
  lng?: number | null;
  geocode_status?: string | null;
  geocode_accuracy?: string | null;
  updated_at?: Date | string | null;
};

export type PatientMcsIntegrationRiskInput = {
  id: string;
  last_sync_status?: string | null;
  last_sync_attempt_at?: Date | string | null;
  last_synced_at?: Date | string | null;
  updated_at?: Date | string | null;
};

export type PatientSharePrivacyRiskInput = {
  id: string;
  status: string;
  share_scope?: unknown;
  ends_at?: Date | string | null;
  updated_at?: Date | string | null;
  consents?: Array<{
    id: string;
    consent_date: Date | string;
    valid_until?: Date | string | null;
    revoked_at?: Date | string | null;
  }>;
};

const BILLING_BLOCKER_TITLE: Record<BillingEvidenceBlocker['key'], string> = {
  missing_visit_consent: '訪問同意が未整備です',
  missing_management_plan: '管理計画書が未整備です',
  management_plan_review_overdue: '管理計画書の見直し期限超過',
  initial_home_visit_assessment_missing: '初回訪問評価の確認が必要です',
  report_delivery_incomplete: '報告書送付が未完了です',
  care_certification_pending: '介護認定情報の確認が必要です',
  public_subsidy_application_pending: '公費申請状況の確認が必要です',
  qr_insurance_review_pending: 'QR保険情報の確認が必要です',
  outcome_not_claimable: '算定条件の確認が必要です',
};

const BILLING_BLOCKER_DETAIL: Record<BillingEvidenceBlocker['key'], string> = {
  missing_visit_consent: '訪問同意が未整備のため、算定根拠を確定できません。',
  missing_management_plan: '管理計画書が未整備のため、算定根拠を確定できません。',
  management_plan_review_overdue: '管理計画書の見直し期限超過により、算定根拠の確認が必要です。',
  initial_home_visit_assessment_missing: '初回訪問評価の記録確認が必要です。',
  report_delivery_incomplete: '報告書送付が未完了のため、算定根拠の確認が必要です。',
  care_certification_pending: '介護認定情報の確認が必要です。',
  public_subsidy_application_pending: '公費申請状況の確認が必要です。',
  qr_insurance_review_pending: 'QR由来保険情報の確認が必要です。',
  outcome_not_claimable: '訪問結果または算定条件の確認が必要です。',
};

const ONBOARDING_DOMAIN: Record<VisitReadyOnboardingBlocker['key'], RiskDomain> = {
  consent_obtained: 'consent_plan',
  emergency_contact_set: 'patient_foundation',
  first_visit_doc_delivered: 'patient_foundation',
  management_plan_approved: 'consent_plan',
  primary_physician_set: 'patient_foundation',
};

const VISIT_READY_SCHEDULE_MISSING_LABEL = '訪問予定が見つかりません';

const READINESS_LABEL_TO_KEY = new Map<string, keyof VisitReadyPreparationChecklist | string>([
  ...VISIT_READY_PREPARATION_ITEMS.map(([key, label]) => [label, key] as const),
  [VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER, 'carry_items_status'],
  [VISIT_READY_SCHEDULE_MISSING_LABEL, 'schedule_missing'],
]);
const READINESS_UNKNOWN_ACTION_LABEL = '訪問準備を確認';

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function billingSeverity(severity: BillingEvidenceBlocker['severity']): RiskSeverity {
  if (severity === 'urgent') return 'urgent';
  return severity === 'high' ? 'warning' : 'warning';
}

function taskSeverity(task: OperationalTaskRiskInput, now = new Date()): RiskSeverity {
  if (task.priority === 'urgent') return 'urgent';
  const dueAt = task.sla_due_at ?? task.due_date;
  if (!dueAt) return 'warning';
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 'warning';
  return due < now ? 'urgent' : 'warning';
}

function dispenseTaskSeverity(task: DispenseTaskRiskInput, now = new Date()): RiskSeverity {
  if (task.priority === 'emergency' || task.priority === 'urgent') return 'urgent';
  const due = task.due_date ? new Date(task.due_date) : null;
  if (due && !Number.isNaN(due.getTime()) && due < now) return 'urgent';
  return 'warning';
}

function prescriptionLineReconciliationSeverity(
  line: PrescriptionLineReconciliationRiskInput,
): RiskSeverity {
  return !line.drug_master_id ? 'urgent' : 'warning';
}

function notificationSeverity(notification: NotificationRiskInput): RiskSeverity {
  return notification.type === 'urgent' ? 'urgent' : 'warning';
}

const COORDINATE_SAME_VALUE_TOLERANCE = 0.000001;

function residenceGeocodeIssue(residence: ResidenceGeocodeRiskInput) {
  const lat = residence.lat;
  const lng = residence.lng;
  if (lat == null || lng == null) return 'missing_coordinates';
  if (lat === 0 && lng === 0) return 'zero_coordinates';
  if (Math.abs(lat - lng) <= COORDINATE_SAME_VALUE_TOLERANCE) return 'same_coordinates';
  if (residence.geocode_status === 'failed' || residence.geocode_status === 'review_required') {
    return 'geocode_review_required';
  }
  if (residence.geocode_accuracy === 'low') return 'low_accuracy';
  return null;
}

function residenceGeocodeSeverity(issue: NonNullable<ReturnType<typeof residenceGeocodeIssue>>) {
  if (issue === 'zero_coordinates' || issue === 'same_coordinates') return 'urgent';
  return 'warning';
}

function residenceGeocodeTitle(issue: NonNullable<ReturnType<typeof residenceGeocodeIssue>>) {
  if (issue === 'missing_coordinates') return '患者住所の座標確認が必要です';
  if (issue === 'zero_coordinates') return '患者住所に仮座標が残っています';
  if (issue === 'same_coordinates') return '患者住所の座標値が不自然です';
  if (issue === 'low_accuracy') return '患者住所の座標精度確認が必要です';
  return '住所ジオコードの再確認が必要です';
}

function patientMcsIntegrationSeverity(link: PatientMcsIntegrationRiskInput): RiskSeverity {
  if (link.last_sync_status === 'failed' && !link.last_synced_at) return 'urgent';
  return 'warning';
}

const PATIENT_SHARE_OUTPUT_SCOPE_KEYS = new Set(['attachments', 'print', 'pdf_output', 'download']);

function patientShareConsentForPolicy(
  consent: NonNullable<PatientSharePrivacyRiskInput['consents']>[number],
) {
  return {
    consent_date: new Date(consent.consent_date),
    valid_until: consent.valid_until ? new Date(consent.valid_until) : null,
    revoked_at: consent.revoked_at ? new Date(consent.revoked_at) : null,
  };
}

function patientShareHasOutputScope(scope: unknown) {
  return enabledPatientShareScopeKeys(scope).some((key) =>
    PATIENT_SHARE_OUTPUT_SCOPE_KEYS.has(key),
  );
}

function foundationSeverity(status: PatientFoundationItem['status']): RiskSeverity {
  if (status === 'missing') return 'blocking';
  if (status === 'needs_confirmation') return 'warning';
  return 'info';
}

function isBeforeJapanDay(left: Date | string | null | undefined, right: Date | string) {
  if (!left) return false;
  return japanDateKey(new Date(left)) < japanDateKey(new Date(right));
}

function stableReadinessKey(label: string, index: number) {
  return READINESS_LABEL_TO_KEY.get(label) ?? `unknown_readiness_blocker_${index + 1}`;
}

function readinessActionLabel(label: string) {
  return READINESS_LABEL_TO_KEY.has(label) ? label : READINESS_UNKNOWN_ACTION_LABEL;
}

export function riskFindingToTaskDedupeKey(finding: RiskFinding) {
  return buildRiskDedupeKey(finding);
}

export function adaptBillingEvidenceBlockerToRiskFinding(
  blocker: BillingEvidenceBlocker,
  context: RiskFindingAdapterContext = {},
): RiskFinding {
  return createRiskFinding({
    key: `billing:${context.billingEvidenceId ?? 'unknown'}:${blocker.key}`,
    domain: 'billing',
    severity: billingSeverity(blocker.severity),
    title: BILLING_BLOCKER_TITLE[blocker.key],
    detail: BILLING_BLOCKER_DETAIL[blocker.key],
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    related_entity_type: 'billing_evidence',
    related_entity_id: context.billingEvidenceId ?? null,
    due_at: context.dueAt ?? null,
    action_href: blocker.action_href,
    action_label: blocker.action_label || '算定根拠を確認',
  });
}

export function adaptVisitReadyTransitionBlockersToRiskFindings(
  details: VisitReadyTransitionBlockers,
  context: RiskFindingAdapterContext = {},
): RiskFinding[] {
  const readiness = details.readiness_blockers.map((label, index) =>
    createRiskFinding({
      key: `visit_ready:readiness:${stableReadinessKey(label, index)}`,
      domain: 'visit_preparation',
      severity: 'blocking',
      title: '訪問準備チェックが未完了です',
      detail: '訪問 ready へ進む前に準備チェックを完了してください。',
      patient_id: context.patientId ?? null,
      case_id: context.caseId ?? null,
      related_entity_type: 'visit_schedule',
      related_entity_id: context.scheduleId ?? null,
      due_at: context.dueAt ?? null,
      action_href: context.scheduleId
        ? `/visits/${encodeURIComponent(context.scheduleId)}/preparation`
        : '/visits',
      action_label: readinessActionLabel(label),
    }),
  );

  const onboarding = details.onboarding_blockers.map((blocker) =>
    createRiskFinding({
      key: `visit_ready:onboarding:${blocker.key}`,
      domain: ONBOARDING_DOMAIN[blocker.key],
      severity: 'blocking',
      title: blocker.label,
      detail: '訪問 ready へ進む前に患者基盤または同意・計画の未整備項目を解消してください。',
      patient_id: context.patientId ?? null,
      case_id: context.caseId ?? null,
      related_entity_type: blocker.key,
      related_entity_id: context.caseId ?? context.patientId ?? null,
      due_at: context.dueAt ?? null,
      action_href: context.patientId
        ? `/patients/${encodeURIComponent(context.patientId)}`
        : '/patients',
      action_label: '患者正本を確認',
    }),
  );

  const billing = details.billing_blockers.map((blocker) =>
    adaptBillingEvidenceBlockerToRiskFinding(blocker, {
      ...context,
      billingEvidenceId: blocker.evidence_id,
      visitRecordId: blocker.visit_record_id ?? context.visitRecordId,
    }),
  );

  return [...readiness, ...onboarding, ...billing];
}

export function adaptPatientFoundationItemToRiskFinding(
  item: PatientFoundationItem,
  context: RiskFindingAdapterContext = {},
): RiskFinding {
  return createRiskFinding({
    key: `patient_foundation:${item.key}`,
    domain: 'patient_foundation',
    severity: foundationSeverity(item.status),
    title: item.label,
    detail:
      item.status === 'ready'
        ? '患者基盤項目は確認済みです。'
        : '患者基盤項目の確認または整備が必要です。',
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    related_entity_type: 'patient_foundation',
    related_entity_id: item.key,
    action_href: item.action_href,
    action_label: item.action_label || '患者基盤を確認',
    resolution_state: item.status === 'ready' ? 'resolved' : 'open',
  });
}

export function adaptConsentPlanLifecycleToRiskFindings(
  input: ConsentPlanRiskInput,
  context: RiskFindingAdapterContext = {},
): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const patientHref = context.patientHref ?? '/patients';
  const base = {
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
  };

  if (!input.consent) {
    findings.push(
      createRiskFinding({
        key: 'missing_visit_consent',
        domain: 'consent_plan',
        severity: 'blocking',
        title: '訪問同意の取得が必要です',
        detail: '訪問薬剤管理の有効同意がないため、訪問・算定の前提を満たしていません。',
        ...base,
        related_entity_type: 'consent_record',
        related_entity_id: null,
        action_href: `${patientHref}/consent`,
        action_label: '同意を整備',
      }),
    );
  }

  if (!input.managementPlan) {
    findings.push(
      createRiskFinding({
        key: 'missing_management_plan',
        domain: 'consent_plan',
        severity: 'blocking',
        title: '承認済み管理計画書がありません',
        detail: '管理計画書が未承認のため、訪問準備と請求根拠を確定できません。',
        ...base,
        related_entity_type: 'management_plan',
        related_entity_id: null,
        action_href: `${patientHref}/management-plan`,
        action_label: '計画書を確認',
      }),
    );
  } else if (isBeforeJapanDay(input.managementPlan.next_review_date, input.now)) {
    findings.push(
      createRiskFinding({
        key: 'management_plan_review_overdue',
        domain: 'consent_plan',
        severity: 'blocking',
        title: '管理計画書の見直し期限超過',
        detail: '承認済み管理計画書の見直し期限を超過しています。',
        ...base,
        related_entity_type: 'management_plan',
        related_entity_id: input.managementPlan.id,
        due_at: iso(input.managementPlan.next_review_date),
        action_href: `${patientHref}/management-plan`,
        action_label: '計画書を見直す',
      }),
    );
  }

  if (!input.firstVisitDocument?.delivered_at) {
    findings.push(
      createRiskFinding({
        key: 'first_visit_document_not_delivered',
        domain: 'patient_foundation',
        severity: 'warning',
        title: '初回訪問説明書の交付が未完了です',
        detail: '初回訪問の説明書交付履歴が確認できません。',
        ...base,
        related_entity_type: 'first_visit_document',
        related_entity_id: input.firstVisitDocument?.id ?? null,
        action_href: patientHref,
        action_label: '患者正本を確認',
      }),
    );
  }

  return findings;
}

export function adaptCareReportToRiskFinding(
  report: CareReportRiskInput,
  context: RiskFindingAdapterContext = {},
): RiskFinding | null {
  if (report.status === 'failed') {
    return createRiskFinding({
      key: `report_delivery_failed:${report.id}`,
      domain: 'report_delivery',
      severity: 'urgent',
      title: '報告書送付に失敗しています',
      detail: '送付失敗の報告書があります。宛先と送付経路を確認してください。',
      patient_id: context.patientId ?? null,
      case_id: context.caseId ?? null,
      related_entity_type: 'care_report',
      related_entity_id: report.id,
      action_href: `/reports/${encodeURIComponent(report.id)}`,
      action_label: '報告書を確認',
    });
  }

  if (report.status === 'response_waiting') {
    return createRiskFinding({
      key: `report_response_waiting:${report.id}`,
      domain: 'report_delivery',
      severity: 'warning',
      title: '報告書の返信待ちです',
      detail: '送付済み報告書の返信確認が残っています。',
      patient_id: context.patientId ?? null,
      case_id: context.caseId ?? null,
      related_entity_type: 'care_report',
      related_entity_id: report.id,
      action_href: `/reports/${encodeURIComponent(report.id)}`,
      action_label: '返信状況を確認',
    });
  }

  return null;
}

export function adaptUpcomingVisitPreparationToRiskFindings(
  schedule: VisitPreparationRiskInput | null,
  context: RiskFindingAdapterContext = {},
): RiskFinding[] {
  if (!schedule) {
    return [
      createRiskFinding({
        key: 'no_upcoming_visit_schedule',
        domain: 'visit_preparation',
        severity: 'info',
        title: '予定中の訪問がありません',
        detail: 'このケースに予定中または準備中の訪問予定はありません。',
        patient_id: context.patientId ?? null,
        case_id: context.caseId ?? null,
        related_entity_type: 'case',
        related_entity_id: context.caseId ?? null,
        action_href: `${context.patientHref ?? '/patients'}?tab=visits`,
        action_label: '訪問予定を確認',
      }),
    ];
  }

  const dueAt = iso(schedule.scheduled_date);
  const findings: RiskFinding[] = [];
  const preparationHref = `/visits/${encodeURIComponent(schedule.id)}/preparation`;

  if (schedule.carry_items_status === 'blocked') {
    findings.push(
      createRiskFinding({
        key: `visit_carry_items_blocked:${schedule.id}`,
        domain: 'visit_preparation',
        severity: 'blocking',
        title: '訪問持参物がブロック中です',
        detail: '訪問前に持参物の未解決項目を確認してください。',
        patient_id: context.patientId ?? null,
        case_id: context.caseId ?? null,
        related_entity_type: 'visit_schedule',
        related_entity_id: schedule.id,
        due_at: dueAt,
        action_href: preparationHref,
        action_label: '訪問準備を確認',
      }),
    );
  }

  if (!schedule.preparation) {
    findings.push(
      createRiskFinding({
        key: `visit_preparation_missing:${schedule.id}`,
        domain: 'visit_preparation',
        severity: 'warning',
        title: '訪問準備チェックが未作成です',
        detail: '訪問準備チェックリストを作成し、出発前確認を完了してください。',
        patient_id: context.patientId ?? null,
        case_id: context.caseId ?? null,
        related_entity_type: 'visit_schedule',
        related_entity_id: schedule.id,
        due_at: dueAt,
        action_href: preparationHref,
        action_label: '準備を開始',
      }),
    );
    return findings;
  }

  const hasMissingChecklist = [
    schedule.preparation.medication_changes_reviewed,
    schedule.preparation.carry_items_confirmed,
    schedule.preparation.previous_issues_reviewed,
    schedule.preparation.route_confirmed,
    schedule.preparation.offline_synced,
  ].some((completed) => !completed);

  if (hasMissingChecklist) {
    findings.push(
      createRiskFinding({
        key: `visit_preparation_incomplete:${schedule.id}`,
        domain: 'visit_preparation',
        severity: 'warning',
        title: '訪問準備チェックが未完了です',
        detail: '薬剤変更、持参物、前回課題、ルート、オフライン同期の確認が残っています。',
        patient_id: context.patientId ?? null,
        case_id: context.caseId ?? null,
        related_entity_type: 'visit_preparation',
        related_entity_id: schedule.preparation.id,
        due_at: dueAt,
        action_href: preparationHref,
        action_label: '未完了チェックを確認',
      }),
    );
  }

  return findings;
}

export function adaptDispenseTaskToRiskFinding(
  task: DispenseTaskRiskInput,
  context: RiskFindingAdapterContext & { now?: Date } = {},
): RiskFinding {
  return createRiskFinding({
    key: `dispense_task:${task.id}`,
    domain: 'dispensing',
    severity: dispenseTaskSeverity(task, context.now),
    title: '調剤・監査タスクが未完了です',
    detail: '調剤、監査、セット準備の未完了タスクがあります。',
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    assigned_to: task.assigned_to ?? null,
    due_at: iso(task.due_date),
    related_entity_type: 'dispense_task',
    related_entity_id: task.id,
    action_href: buildDispenseTaskHref(task.id),
    action_label: '調剤タスクを確認',
  });
}

export function adaptPrescriptionLineReconciliationToRiskFinding(
  line: PrescriptionLineReconciliationRiskInput,
  context: RiskFindingAdapterContext = {},
): RiskFinding {
  return createRiskFinding({
    key: `drug_master_reconciliation:${line.id}`,
    domain: 'medication',
    severity: prescriptionLineReconciliationSeverity(line),
    title: '薬剤マスタ照合が必要です',
    detail: '処方行に薬剤マスタ未照合または照合状態未確定の項目があります。',
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    related_entity_type: 'prescription_line',
    related_entity_id: line.id,
    action_href: `/medications/reconciliation?line_id=${encodeURIComponent(line.id)}`,
    action_label: '薬剤マスタを照合',
  });
}

export function adaptNotificationToRiskFinding(
  notification: NotificationRiskInput,
  context: RiskFindingAdapterContext = {},
): RiskFinding {
  return createRiskFinding({
    key: `notification:${notification.id}`,
    domain: 'notification',
    severity: notificationSeverity(notification),
    title: '未読の重要通知があります',
    detail:
      'この患者またはケースに関連する未読通知が残っています。通知センターで内容と対応状況を確認してください。',
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    related_entity_type: 'notification',
    related_entity_id: notification.id,
    due_at: iso(notification.created_at),
    action_href: `/notifications?notification_id=${encodeURIComponent(notification.id)}`,
    action_label: '通知を確認',
  });
}

export function adaptResidenceGeocodeToRiskFinding(
  residence: ResidenceGeocodeRiskInput,
  context: RiskFindingAdapterContext = {},
): RiskFinding | null {
  const issue = residenceGeocodeIssue(residence);
  if (!issue) return null;

  return createRiskFinding({
    key: `residence_geocode:${residence.id}:${issue}`,
    domain: 'data_quality',
    severity: residenceGeocodeSeverity(issue),
    title: residenceGeocodeTitle(issue),
    detail: '訪問提案・移動時間計算に使う患者住所の座標品質を確認してください。',
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    related_entity_type: 'residence',
    related_entity_id: residence.id,
    due_at: iso(residence.updated_at),
    action_href: context.patientId
      ? `/patients/${encodeURIComponent(context.patientId)}/edit?section=visit#intake.address`
      : '/patients?foundation_gap=1',
    action_label: '住所座標を確認',
  });
}

export function adaptPatientMcsIntegrationToRiskFinding(
  link: PatientMcsIntegrationRiskInput,
  context: RiskFindingAdapterContext = {},
): RiskFinding | null {
  if (!link.last_sync_status || link.last_sync_status === 'success') return null;

  return createRiskFinding({
    key: `patient_mcs_sync:${link.id}`,
    domain: 'integration',
    severity: patientMcsIntegrationSeverity(link),
    title: 'MCS連携の同期確認が必要です',
    detail: 'MCS連携の同期状態が正常ではありません。連携先と再同期結果を確認してください。',
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    related_entity_type: 'patient_mcs_link',
    related_entity_id: link.id,
    due_at: iso(link.last_sync_attempt_at ?? link.updated_at),
    action_href: context.patientId
      ? `/patients/${encodeURIComponent(context.patientId)}/mcs`
      : '/patients',
    action_label: 'MCS連携を確認',
  });
}

export function adaptPatientSharePrivacyToRiskFindings(
  shareCase: PatientSharePrivacyRiskInput,
  context: RiskFindingAdapterContext & { now?: Date | string } = {},
): RiskFinding[] {
  if (shareCase.status !== 'active') return [];

  const now = context.now ?? new Date();
  const patientHref = context.patientId
    ? `/patients/${encodeURIComponent(context.patientId)}`
    : '/patients';
  const actionHref = `${patientHref}/share`;
  const findings: RiskFinding[] = [];
  const base = {
    domain: 'privacy_security' as const,
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    related_entity_type: 'patient_share_case',
    related_entity_id: shareCase.id,
    action_href: actionHref,
    action_label: '共有設定を確認',
  };

  if (isBeforeJapanDay(shareCase.ends_at, now)) {
    findings.push(
      createRiskFinding({
        ...base,
        key: `patient_share_expired:${shareCase.id}`,
        severity: 'urgent',
        title: '外部共有の終了日を過ぎています',
        detail:
          '有効状態の患者共有が終了日を過ぎています。共有停止または期間更新を確認してください。',
        due_at: iso(shareCase.ends_at),
      }),
    );
  }

  const activeConsent = findActivePatientShareConsent(
    (shareCase.consents ?? []).map(patientShareConsentForPolicy),
    new Date(now),
  );
  if (!activeConsent) {
    findings.push(
      createRiskFinding({
        ...base,
        key: `patient_share_missing_active_consent:${shareCase.id}`,
        severity: 'urgent',
        title: '外部共有の有効同意を確認してください',
        detail: '有効状態の患者共有に、現在有効な共有同意が確認できません。',
        due_at: iso(shareCase.updated_at),
      }),
    );
  }

  if (patientShareHasOutputScope(shareCase.share_scope)) {
    findings.push(
      createRiskFinding({
        ...base,
        key: `patient_share_output_scope_review:${shareCase.id}`,
        severity: 'warning',
        title: '外部共有の出力権限レビューが必要です',
        detail:
          '添付、印刷、PDF、ダウンロードなどの出力を許可する共有 scope が有効です。目的と期限を確認してください。',
        due_at: iso(shareCase.updated_at),
      }),
    );
  }

  return findings;
}

export function adaptOperationalTaskToRiskFinding(
  task: OperationalTaskRiskInput,
  context: RiskFindingAdapterContext & { now?: Date } = {},
): RiskFinding {
  const presentation = describeOperationalTask(task);
  return createRiskFinding({
    key: `task:${task.id}`,
    domain: 'task_sla',
    severity: taskSeverity(task, context.now),
    title: `${presentation.queueLabel}タスク`,
    detail: '未解決の運用タスクがあります。',
    patient_id: context.patientId ?? null,
    case_id: context.caseId ?? null,
    assigned_to: task.assigned_to ?? null,
    due_at: iso(task.sla_due_at ?? task.due_date),
    related_entity_type: 'task',
    related_entity_id: task.id,
    action_href: presentation.actionHref,
    action_label: presentation.actionLabel,
    source: 'manual',
  });
}
