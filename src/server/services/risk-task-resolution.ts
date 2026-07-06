import { Prisma } from '@prisma/client';
import {
  RISK_DOMAIN_ORDER,
  createRiskFinding,
  type RiskDomain,
  type RiskFindingSource,
  type RiskSeverity,
} from '@/lib/risk/risk-finding';
import { readJsonObject } from '@/lib/db/json';
import { RISK_TASK_REGISTRY, getRiskTaskRegistryEntry } from '@/lib/tasks/task-registry';
import type { AuthContext } from '@/lib/auth/context';
import { waiveOperationalTaskForRiskWithAudit } from '@/server/services/risk-task-bridge';

type RiskTaskResolutionTx = {
  task: {
    findFirst(args: unknown): Promise<RiskTaskResolutionTask | null>;
    findMany(args: unknown): Promise<Array<{ id: string; metadata: Prisma.JsonValue | null }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
} & Parameters<typeof waiveOperationalTaskForRiskWithAudit>[0];

const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const;
const RISK_SEVERITIES: readonly RiskSeverity[] = ['blocking', 'urgent', 'warning', 'info'];
const RISK_SOURCES: readonly RiskFindingSource[] = ['computed', 'manual', 'external'];
const RISK_TASK_TYPES: ReadonlySet<string> = new Set(
  Object.values(RISK_TASK_REGISTRY).map((entry) => entry.task_type),
);

const riskTaskResolutionSelect = {
  id: true,
  task_type: true,
  display_id: true,
  status: true,
  metadata: true,
  dedupe_key: true,
  related_entity_type: true,
  related_entity_id: true,
} satisfies Prisma.TaskSelect;

type RiskTaskResolutionTask = Prisma.TaskGetPayload<{ select: typeof riskTaskResolutionSelect }>;

export type WaiveRiskOperationalTaskInput = {
  orgId: string;
  caseId: string;
  taskId: string;
  ctx: AuthContext;
  waiverReason: string;
  reasonCode?: string | null;
};

export type WaiveRiskOperationalTaskResult =
  | {
      status: 'waived';
      task_id: string;
      display_id: string | null;
      case_id: string;
      risk_domain: RiskDomain;
      updated_task_count: number;
    }
  | { status: 'not_found' }
  | { status: 'conflict' }
  | { status: 'invalid_risk_task' };

export async function waiveRiskOperationalTaskById(
  tx: RiskTaskResolutionTx,
  input: WaiveRiskOperationalTaskInput,
): Promise<WaiveRiskOperationalTaskResult> {
  const task = await tx.task.findFirst({
    where: {
      id: input.taskId,
      org_id: input.orgId,
    },
    select: riskTaskResolutionSelect,
  });
  if (!task) return { status: 'not_found' };
  if (!OPEN_TASK_STATUSES.includes(task.status as (typeof OPEN_TASK_STATUSES)[number])) {
    return { status: 'conflict' };
  }
  if (!RISK_TASK_TYPES.has(task.task_type)) return { status: 'invalid_risk_task' };

  const finding = riskTaskToWaivedFinding(task, input.caseId);
  if (!finding) return { status: 'invalid_risk_task' };

  const resolved = await waiveOperationalTaskForRiskWithAudit(tx, {
    orgId: input.orgId,
    taskId: input.taskId,
    finding,
    ctx: input.ctx,
    waiverReason: input.waiverReason,
    reasonCode: input.reasonCode,
  }).catch((err) => {
    if (
      err instanceof Error &&
      err.message === 'Risk task waiver did not update exactly one task'
    ) {
      return null;
    }
    throw err;
  });
  if (!resolved) return { status: 'conflict' };
  const updatedTaskCount =
    typeof resolved === 'object' &&
    resolved !== null &&
    'count' in resolved &&
    typeof resolved.count === 'number'
      ? resolved.count
      : 1;

  return {
    status: 'waived',
    task_id: task.id,
    display_id: task.display_id,
    case_id: input.caseId,
    risk_domain: finding.domain,
    updated_task_count: updatedTaskCount,
  };
}

function riskTaskToWaivedFinding(task: RiskTaskResolutionTask, caseId: string) {
  const metadata = readJsonObject(task.metadata);
  if (!metadata || metadata.source !== 'risk_finding') return null;
  if (readNonBlankString(metadata.case_id) !== caseId) return null;

  const domain = readRiskDomain(metadata.risk_domain);
  const entry = domain ? getRiskTaskRegistryEntry(domain) : null;
  if (!domain || !entry || entry.task_type !== task.task_type) return null;

  const key = readNonBlankString(metadata.risk_key);
  if (!key) return null;

  const severity = readRiskSeverity(metadata.risk_severity) ?? 'urgent';
  const source = readRiskSource(metadata.risk_source) ?? 'computed';
  const relatedEntityType =
    readNonBlankString(metadata.related_entity_type) ?? task.related_entity_type ?? null;
  const relatedEntityId =
    readNonBlankString(metadata.related_entity_id) ?? task.related_entity_id ?? null;

  return createRiskFinding({
    key,
    domain,
    severity,
    title: `${entry.owner_domain} risk task`,
    detail: 'Risk task was waived through the dedicated risk resolution route.',
    patient_id: readNonBlankString(metadata.patient_id),
    case_id: caseId,
    related_entity_type: relatedEntityType,
    related_entity_id: relatedEntityId,
    action_href: readNonBlankString(metadata.action_href) ?? '/tasks',
    action_label: 'リスク対応を確認',
    resolution_state: 'waived',
    source,
  });
}

function readRiskDomain(value: unknown): RiskDomain | null {
  return typeof value === 'string' && RISK_DOMAIN_ORDER.includes(value as RiskDomain)
    ? (value as RiskDomain)
    : null;
}

function readRiskSeverity(value: unknown): RiskSeverity | null {
  return typeof value === 'string' && RISK_SEVERITIES.includes(value as RiskSeverity)
    ? (value as RiskSeverity)
    : null;
}

function readRiskSource(value: unknown): RiskFindingSource | null {
  return typeof value === 'string' && RISK_SOURCES.includes(value as RiskFindingSource)
    ? (value as RiskFindingSource)
    : null;
}

function readNonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
