import { Prisma } from '@prisma/client';
import { buildRiskDedupeKey, isRiskFindingActive, type RiskFinding } from '@/lib/risk/risk-finding';
import {
  buildRiskTaskDescription,
  buildRiskTaskTitle,
  getTaskTypeDefinition,
  getRiskTaskRegistryEntry,
  type TaskPriority,
} from '@/lib/tasks/task-registry';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  resolveOperationalTasks,
  upsertOperationalTask,
  type ResolveOperationalTaskInput,
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
    (finding.severity === 'blocking' ||
      finding.severity === 'urgent' ||
      isMedicationStockTaskableFinding(finding))
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

  const target = resolveRiskTaskTarget(input.finding);

  return {
    orgId: input.orgId,
    taskType: target.taskType,
    title: target.title,
    description: target.description,
    priority: riskSeverityToTaskPriority(input.finding),
    assignedTo: input.finding.assigned_to ?? null,
    dueDate: parseRiskDueAt(input.finding.due_at),
    slaDueAt: parseRiskDueAt(input.finding.due_at),
    dedupeKey: buildRiskDedupeKey(input.finding),
    relatedEntityType: target.relatedEntityType,
    relatedEntityId: target.relatedEntityId,
    metadata: buildRiskTaskMetadata(input.finding, target.entry),
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
  const target = resolveRiskTaskTarget(input.finding);
  return {
    orgId: input.orgId,
    taskId: input.taskId,
    dedupeKey: buildRiskDedupeKey(input.finding),
    taskType: target.taskType,
    relatedEntityType: target.relatedEntityType,
    relatedEntityId: target.relatedEntityId,
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

type RiskTaskTarget = {
  taskType: string;
  title: string;
  description: string;
  relatedEntityType: string;
  relatedEntityId: string;
  entry: ReturnType<typeof getRiskTaskRegistryEntry>;
};

function resolveRiskTaskTarget(finding: RiskFinding): RiskTaskTarget {
  const entry = getRiskTaskRegistryEntry(finding.domain);
  const medicationStockTaskType = resolveMedicationStockRiskTaskType(finding);
  const medicationStockDefinition = medicationStockTaskType
    ? getTaskTypeDefinition(medicationStockTaskType)
    : null;

  if (medicationStockDefinition && finding.patient_id) {
    return {
      taskType: medicationStockDefinition.taskType,
      title: medicationStockDefinition.label,
      description: medicationStockDefinition.description,
      relatedEntityType: 'patient',
      relatedEntityId: finding.patient_id,
      entry,
    };
  }

  return {
    taskType: entry.task_type,
    title: buildRiskTaskTitle(finding.domain),
    description: buildRiskTaskDescription(finding.domain),
    relatedEntityType: finding.related_entity_type ?? entry.related_entity_type,
    relatedEntityId:
      finding.related_entity_id ?? finding.case_id ?? finding.patient_id ?? finding.key,
    entry,
  };
}

function resolveMedicationStockRiskTaskType(finding: RiskFinding) {
  if (finding.domain !== 'medication') return null;

  const code = /^medication_stock:([^:]+):/.exec(finding.key)?.[1] ?? null;
  switch (code) {
    case 'medication_stock_urgent_shortage':
      return 'pharmacy.medication_stock_shortage_expected';
    case 'medication_stock_usage_report_review_required':
      return 'pharmacy.medication_stock_usage_unknown';
    case 'medication_stock_equivalence_review_required':
      return 'pharmacy.medication_stock_equivalence_review_required';
    case 'medication_stock_external_observation_review_required':
      return 'pharmacy.medication_stock_external_observation_review_required';
    default:
      return null;
  }
}

function isMedicationStockTaskableFinding(finding: RiskFinding) {
  return resolveMedicationStockRiskTaskType(finding) !== null && Boolean(finding.patient_id);
}
