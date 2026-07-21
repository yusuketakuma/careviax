import type { PhosModuleId } from '@/core/module-registry';
import type { RiskDomain } from '@/lib/risk/risk-finding';

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export type TaskLike = {
  id?: string;
  task_type: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

export type TaskActionPresentation = {
  actionHref: string;
  actionLabel: string;
  queueLabel: string;
};

export type TaskTypeDefinition = {
  taskType: `${Exclude<PhosModuleId, 'core'> | 'core'}.${string}`;
  module: PhosModuleId;
  label: string;
  description: string;
  defaultPriority: TaskPriority;
  allowedRelatedEntityTypes: readonly string[];
  legacyTaskTypes?: readonly string[];
  actionBuilder?: (task: TaskLike) => TaskActionPresentation;
};

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
