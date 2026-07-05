import type { BillingEvidenceBlocker } from '@/server/services/billing-evidence/core';
import {
  VISIT_READY_CARRY_ITEMS_STATUS_BLOCKER,
  VISIT_READY_PREPARATION_ITEMS,
  type VisitReadyOnboardingBlocker,
  type VisitReadyPreparationChecklist,
  type VisitReadyTransitionBlockers,
} from '@/server/services/visit-preparation-readiness';
import type { PatientFoundationItem } from '@/server/services/patient-detail-foundation';
import { describeOperationalTask } from '@/lib/tasks/operational-task-presentation';
import {
  buildRiskDedupeKey,
  createRiskFinding,
  type RiskDomain,
  type RiskFinding,
  type RiskSeverity,
} from '@/lib/risk/risk-finding';

export type RiskFindingAdapterContext = {
  patientId?: string | null;
  caseId?: string | null;
  scheduleId?: string | null;
  visitRecordId?: string | null;
  billingEvidenceId?: string | null;
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

function foundationSeverity(status: PatientFoundationItem['status']): RiskSeverity {
  if (status === 'missing') return 'blocking';
  if (status === 'needs_confirmation') return 'warning';
  return 'info';
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
