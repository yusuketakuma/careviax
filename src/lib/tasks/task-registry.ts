import { RISK_DOMAIN_LABELS, type RiskDomain } from '@/lib/risk/risk-finding';
import type { TaskPriority } from '@/server/services/operational-tasks';

export type RiskTaskRegistryEntry = {
  owner_domain: RiskDomain;
  task_type: string;
  default_priority: TaskPriority;
  stale_threshold_days: number;
  patient_safety: boolean;
  billing_close: boolean;
  related_entity_type: string;
};

export const RISK_TASK_REGISTRY = {
  patient_foundation: {
    owner_domain: 'patient_foundation',
    task_type: 'risk_patient_foundation',
    default_priority: 'high',
    stale_threshold_days: 7,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'patient_foundation',
  },
  consent_plan: {
    owner_domain: 'consent_plan',
    task_type: 'risk_consent_plan',
    default_priority: 'urgent',
    stale_threshold_days: 3,
    patient_safety: true,
    billing_close: true,
    related_entity_type: 'consent_plan',
  },
  medication: {
    owner_domain: 'medication',
    task_type: 'risk_medication',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'medication',
  },
  dispensing: {
    owner_domain: 'dispensing',
    task_type: 'risk_dispensing',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'dispensing',
  },
  visit_preparation: {
    owner_domain: 'visit_preparation',
    task_type: 'risk_visit_preparation',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'visit_preparation',
  },
  visit_record: {
    owner_domain: 'visit_record',
    task_type: 'risk_visit_record',
    default_priority: 'high',
    stale_threshold_days: 2,
    patient_safety: true,
    billing_close: true,
    related_entity_type: 'visit_record',
  },
  report_delivery: {
    owner_domain: 'report_delivery',
    task_type: 'risk_report_delivery',
    default_priority: 'high',
    stale_threshold_days: 3,
    patient_safety: false,
    billing_close: true,
    related_entity_type: 'care_report',
  },
  billing: {
    owner_domain: 'billing',
    task_type: 'risk_billing',
    default_priority: 'high',
    stale_threshold_days: 5,
    patient_safety: false,
    billing_close: true,
    related_entity_type: 'billing_evidence',
  },
  task_sla: {
    owner_domain: 'task_sla',
    task_type: 'risk_task_sla',
    default_priority: 'high',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'task',
  },
  notification: {
    owner_domain: 'notification',
    task_type: 'risk_notification',
    default_priority: 'high',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'notification',
  },
  privacy_security: {
    owner_domain: 'privacy_security',
    task_type: 'risk_privacy_security',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'privacy_security',
  },
  integration: {
    owner_domain: 'integration',
    task_type: 'risk_integration',
    default_priority: 'high',
    stale_threshold_days: 2,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'integration',
  },
  data_quality: {
    owner_domain: 'data_quality',
    task_type: 'risk_data_quality',
    default_priority: 'high',
    stale_threshold_days: 7,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'data_quality',
  },
} as const satisfies Record<RiskDomain, RiskTaskRegistryEntry>;

export function getRiskTaskRegistryEntry(domain: RiskDomain): RiskTaskRegistryEntry {
  return RISK_TASK_REGISTRY[domain];
}

export function buildRiskTaskTitle(domain: RiskDomain) {
  return `${RISK_DOMAIN_LABELS[domain]}の対応`;
}

export function buildRiskTaskDescription(domain: RiskDomain) {
  return `${RISK_DOMAIN_LABELS[domain]}の未解決リスクを確認し、対応状況を更新してください。`;
}
