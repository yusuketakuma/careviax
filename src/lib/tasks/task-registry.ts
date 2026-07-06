import { RISK_DOMAIN_LABELS, type RiskDomain } from '@/lib/risk/risk-finding';
import type { TaskPriority } from '@/server/services/operational-tasks';

export type RiskTaskResolveStrategy = 'active_finding_absent' | 'manual_or_waiver_only';
export type RiskTaskResolvePredicate = 'patient_mcs_sync_success' | 'residence_geocode_valid';

export type RiskTaskResolveCondition = {
  strategy: RiskTaskResolveStrategy;
  requires_related_entity: boolean;
  predicate?: RiskTaskResolvePredicate;
};

export type RiskTaskRegistryEntry = {
  owner_domain: RiskDomain;
  task_type: string;
  default_priority: TaskPriority;
  stale_threshold_days: number;
  patient_safety: boolean;
  billing_close: boolean;
  related_entity_type: string;
  resolve_condition: RiskTaskResolveCondition;
};

const ACTIVE_FINDING_ABSENT_WITH_ENTITY = {
  strategy: 'active_finding_absent',
  requires_related_entity: true,
} as const satisfies RiskTaskResolveCondition;

const ACTIVE_FINDING_ABSENT_CASE_LEVEL = {
  strategy: 'active_finding_absent',
  requires_related_entity: false,
} as const satisfies RiskTaskResolveCondition;

export const RISK_TASK_REGISTRY = {
  patient_foundation: {
    owner_domain: 'patient_foundation',
    task_type: 'risk_patient_foundation',
    default_priority: 'high',
    stale_threshold_days: 7,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'patient_foundation',
    resolve_condition: ACTIVE_FINDING_ABSENT_CASE_LEVEL,
  },
  consent_plan: {
    owner_domain: 'consent_plan',
    task_type: 'risk_consent_plan',
    default_priority: 'urgent',
    stale_threshold_days: 3,
    patient_safety: true,
    billing_close: true,
    related_entity_type: 'consent_plan',
    resolve_condition: ACTIVE_FINDING_ABSENT_CASE_LEVEL,
  },
  medication: {
    owner_domain: 'medication',
    task_type: 'risk_medication',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'medication',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  dispensing: {
    owner_domain: 'dispensing',
    task_type: 'risk_dispensing',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'dispensing',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  visit_preparation: {
    owner_domain: 'visit_preparation',
    task_type: 'risk_visit_preparation',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'visit_preparation',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  visit_record: {
    owner_domain: 'visit_record',
    task_type: 'risk_visit_record',
    default_priority: 'high',
    stale_threshold_days: 2,
    patient_safety: true,
    billing_close: true,
    related_entity_type: 'visit_record',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  report_delivery: {
    owner_domain: 'report_delivery',
    task_type: 'risk_report_delivery',
    default_priority: 'high',
    stale_threshold_days: 3,
    patient_safety: false,
    billing_close: true,
    related_entity_type: 'care_report',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  billing: {
    owner_domain: 'billing',
    task_type: 'risk_billing',
    default_priority: 'high',
    stale_threshold_days: 5,
    patient_safety: false,
    billing_close: true,
    related_entity_type: 'billing_evidence',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  task_sla: {
    owner_domain: 'task_sla',
    task_type: 'risk_task_sla',
    default_priority: 'high',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'task',
    resolve_condition: {
      strategy: 'manual_or_waiver_only',
      requires_related_entity: true,
    },
  },
  notification: {
    owner_domain: 'notification',
    task_type: 'risk_notification',
    default_priority: 'high',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'notification',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  privacy_security: {
    owner_domain: 'privacy_security',
    task_type: 'risk_privacy_security',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'privacy_security',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  integration: {
    owner_domain: 'integration',
    task_type: 'risk_integration',
    default_priority: 'high',
    stale_threshold_days: 2,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'integration',
    resolve_condition: {
      ...ACTIVE_FINDING_ABSENT_WITH_ENTITY,
      predicate: 'patient_mcs_sync_success',
    },
  },
  data_quality: {
    owner_domain: 'data_quality',
    task_type: 'risk_data_quality',
    default_priority: 'high',
    stale_threshold_days: 7,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'data_quality',
    resolve_condition: {
      ...ACTIVE_FINDING_ABSENT_WITH_ENTITY,
      predicate: 'residence_geocode_valid',
    },
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
