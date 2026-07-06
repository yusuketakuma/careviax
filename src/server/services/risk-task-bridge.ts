import { Prisma } from '@prisma/client';
import { buildRiskDedupeKey, isRiskFindingActive, type RiskFinding } from '@/lib/risk/risk-finding';
import {
  buildRiskTaskDescription,
  buildRiskTaskTitle,
  getRiskTaskRegistryEntry,
} from '@/lib/tasks/task-registry';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  resolveOperationalTasks,
  upsertOperationalTask,
  type ResolveOperationalTaskInput,
  type TaskPriority,
  type UpsertOperationalTaskInput,
} from '@/server/services/operational-tasks';

type RiskTaskBridgeTx = Parameters<typeof upsertOperationalTask>[0];
type RiskTaskAuditTx = RiskTaskBridgeTx & Parameters<typeof createAuditLogEntry>[0];
type RiskTaskAuditContext = Parameters<typeof createAuditLogEntry>[1];

export type RiskTaskBridgeInput = {
  orgId: string;
  finding: RiskFinding;
  taskId?: string | null;
};

export type ResolveRiskTaskInput = RiskTaskBridgeInput & {
  status?: 'completed';
};

export type WaiveRiskTaskInput = RiskTaskBridgeInput & {
  actorUserId: string;
  waiverReason: string;
  auditLogId: string;
  reasonCode?: string | null;
};

export type WaiveRiskTaskWithAuditInput = RiskTaskBridgeInput & {
  ctx: RiskTaskAuditContext;
  waiverReason: string;
  reasonCode?: string | null;
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
    taskId: input.taskId,
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
    ...riskFindingToResolveOperationalTaskInput({
      orgId: input.orgId,
      taskId: input.taskId,
      finding: input.finding,
    }),
    status: 'cancelled',
    resolution: {
      state: 'waived',
      actorUserId: input.actorUserId,
      auditLogId: input.auditLogId,
      reasonPresent: true,
      reasonLength: reason.length,
      reasonCode: input.reasonCode,
    },
  };
}

export async function waiveOperationalTaskForRisk(tx: RiskTaskBridgeTx, input: WaiveRiskTaskInput) {
  return resolveOperationalTasks(tx, riskFindingToWaiveOperationalTaskInput(input));
}

export function buildRiskTaskWaiverAuditChanges(
  input: Pick<WaiveRiskTaskInput, 'finding' | 'waiverReason' | 'reasonCode'>,
): Prisma.InputJsonObject {
  const reason = input.waiverReason.trim();
  if (!reason) {
    throw new Error('Risk task waiver requires waiverReason');
  }
  return {
    risk_domain: input.finding.domain,
    risk_severity: input.finding.severity,
    risk_resolution_state: 'waived',
    task_resolution_status: 'cancelled',
    related_entity_type: input.finding.related_entity_type ?? null,
    related_entity_id: input.finding.related_entity_id ?? null,
    case_id: input.finding.case_id ?? null,
    reason_code: input.reasonCode?.trim() || null,
    reason_present: true,
    reason_length: reason.length,
    reason_redacted: true,
  };
}

export async function waiveOperationalTaskForRiskWithAudit(
  tx: RiskTaskAuditTx,
  input: WaiveRiskTaskWithAuditInput,
) {
  const audit = await createAuditLogEntry(tx, input.ctx, {
    action: 'risk_finding_waived',
    targetType: 'risk_finding',
    targetId: buildRiskDedupeKey(input.finding),
    patientId: input.finding.patient_id ?? undefined,
    changes: buildRiskTaskWaiverAuditChanges(input),
  });
  const auditId =
    audit && typeof audit === 'object' && 'id' in audit && typeof audit.id === 'string'
      ? audit.id
      : null;
  if (!auditId) {
    throw new Error('Risk task waiver audit did not return an id');
  }

  const resolved = await waiveOperationalTaskForRisk(tx, {
    orgId: input.orgId,
    taskId: input.taskId,
    finding: input.finding,
    actorUserId: input.ctx.userId,
    waiverReason: input.waiverReason,
    reasonCode: input.reasonCode,
    auditLogId: auditId,
  });
  if (
    typeof resolved !== 'object' ||
    resolved === null ||
    !('count' in resolved) ||
    typeof resolved.count !== 'number' ||
    resolved.count !== 1
  ) {
    throw new Error('Risk task waiver did not update exactly one task');
  }
  return resolved;
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
