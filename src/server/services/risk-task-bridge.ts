import { Prisma } from '@prisma/client';
import { buildRiskDedupeKey, isRiskFindingActive, type RiskFinding } from '@/lib/risk/risk-finding';
import {
  buildRiskTaskDescription,
  buildRiskTaskTitle,
  getRiskTaskRegistryEntry,
} from '@/lib/tasks/task-registry';
import {
  resolveOperationalTasks,
  upsertOperationalTask,
  type ResolveOperationalTaskInput,
  type TaskPriority,
  type UpsertOperationalTaskInput,
} from '@/server/services/operational-tasks';

type RiskTaskBridgeTx = Parameters<typeof upsertOperationalTask>[0];

export type RiskTaskBridgeInput = {
  orgId: string;
  finding: RiskFinding;
};

export type ResolveRiskTaskInput = RiskTaskBridgeInput & {
  status?: 'completed';
};

export type WaiveRiskTaskInput = RiskTaskBridgeInput & {
  actorUserId: string;
  waiverReason: string;
  auditLogId: string;
};

export function shouldCreateOperationalTaskForRisk(finding: RiskFinding) {
  return (
    finding.domain !== 'task_sla' &&
    isRiskFindingActive(finding) &&
    (finding.severity === 'blocking' || finding.severity === 'urgent')
  );
}

export function riskSeverityToTaskPriority(finding: Pick<RiskFinding, 'severity'>): TaskPriority {
  if (finding.severity === 'blocking' || finding.severity === 'urgent') return 'urgent';
  if (finding.severity === 'warning') return 'high';
  return 'low';
}

export function riskFindingToOperationalTaskInput(
  input: RiskTaskBridgeInput,
): UpsertOperationalTaskInput | null {
  if (!shouldCreateOperationalTaskForRisk(input.finding)) return null;

  const entry = getRiskTaskRegistryEntry(input.finding.domain);
  const relatedEntityType = input.finding.related_entity_type ?? entry.related_entity_type;
  const relatedEntityId =
    input.finding.related_entity_id ??
    input.finding.case_id ??
    input.finding.patient_id ??
    input.finding.key;

  return {
    orgId: input.orgId,
    taskType: entry.task_type,
    title: buildRiskTaskTitle(input.finding.domain),
    description: buildRiskTaskDescription(input.finding.domain),
    priority: riskSeverityToTaskPriority(input.finding),
    assignedTo: input.finding.assigned_to ?? null,
    dueDate: parseRiskDueAt(input.finding.due_at),
    slaDueAt: parseRiskDueAt(input.finding.due_at),
    dedupeKey: buildRiskDedupeKey(input.finding),
    relatedEntityType,
    relatedEntityId,
    metadata: buildRiskTaskMetadata(input.finding, entry),
    status: 'pending',
  };
}

function parseRiskDueAt(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function upsertOperationalTaskForRisk(
  tx: RiskTaskBridgeTx,
  input: RiskTaskBridgeInput,
) {
  const taskInput = riskFindingToOperationalTaskInput(input);
  if (!taskInput) return null;
  return upsertOperationalTask(tx, taskInput);
}

export function riskFindingToResolveOperationalTaskInput(
  input: ResolveRiskTaskInput,
): ResolveOperationalTaskInput {
  const entry = getRiskTaskRegistryEntry(input.finding.domain);
  return {
    orgId: input.orgId,
    dedupeKey: buildRiskDedupeKey(input.finding),
    taskType: entry.task_type,
    relatedEntityType: input.finding.related_entity_type ?? entry.related_entity_type,
    relatedEntityId:
      input.finding.related_entity_id ??
      input.finding.case_id ??
      input.finding.patient_id ??
      input.finding.key,
    status: input.status ?? 'completed',
  };
}

export async function resolveOperationalTaskForRisk(
  tx: RiskTaskBridgeTx,
  input: ResolveRiskTaskInput,
) {
  return resolveOperationalTasks(tx, riskFindingToResolveOperationalTaskInput(input));
}

export function riskFindingToWaiveOperationalTaskInput(
  input: WaiveRiskTaskInput,
): ResolveOperationalTaskInput {
  const reason = input.waiverReason.trim();
  if (!input.actorUserId.trim()) {
    throw new Error('Risk task waiver requires actorUserId');
  }
  if (!reason) {
    throw new Error('Risk task waiver requires waiverReason');
  }
  if (!input.auditLogId.trim()) {
    throw new Error('Risk task waiver requires auditLogId');
  }
  return {
    ...riskFindingToResolveOperationalTaskInput({ orgId: input.orgId, finding: input.finding }),
    status: 'cancelled',
  };
}

export async function waiveOperationalTaskForRisk(tx: RiskTaskBridgeTx, input: WaiveRiskTaskInput) {
  return resolveOperationalTasks(tx, riskFindingToWaiveOperationalTaskInput(input));
}

function buildRiskTaskMetadata(
  finding: RiskFinding,
  entry: ReturnType<typeof getRiskTaskRegistryEntry>,
): Prisma.InputJsonObject {
  return {
    source: 'risk_finding',
    risk_domain: finding.domain,
    risk_key: finding.key,
    risk_severity: finding.severity,
    risk_source: finding.source,
    action_href: finding.action_href,
    related_entity_type: finding.related_entity_type ?? null,
    related_entity_id: finding.related_entity_id ?? null,
    patient_id: finding.patient_id ?? null,
    case_id: finding.case_id ?? null,
    owner_domain: entry.owner_domain,
    patient_safety: entry.patient_safety,
    billing_close: entry.billing_close,
    stale_threshold_days: entry.stale_threshold_days,
  };
}
