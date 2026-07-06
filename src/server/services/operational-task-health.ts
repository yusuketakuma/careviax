import { Prisma } from '@prisma/client';
import { readJsonObject } from '@/lib/db/json';
import { RISK_DOMAIN_LABELS, RISK_DOMAIN_ORDER, type RiskDomain } from '@/lib/risk/risk-finding';
import { RISK_TASK_REGISTRY } from '@/lib/tasks/task-registry';

const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const;
export const DEFAULT_OPERATIONAL_TASK_HEALTH_LIMIT = 500;
export const MAX_OPERATIONAL_TASK_HEALTH_LIMIT = 1000;

const RISK_TASK_TYPES: ReadonlySet<string> = new Set(
  Object.values(RISK_TASK_REGISTRY).map((entry) => entry.task_type),
);
const RISK_DOMAIN_BY_TASK_TYPE: ReadonlyMap<string, RiskDomain> = new Map(
  Object.entries(RISK_TASK_REGISTRY).map(([domain, entry]) => [
    entry.task_type,
    domain as RiskDomain,
  ]),
);

const taskHealthSelect = {
  id: true,
  display_id: true,
  task_type: true,
  status: true,
  priority: true,
  assigned_to: true,
  due_date: true,
  sla_due_at: true,
  dedupe_key: true,
  related_entity_type: true,
  related_entity_id: true,
  metadata: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.TaskSelect;

type OperationalTaskHealthTask = Prisma.TaskGetPayload<{ select: typeof taskHealthSelect }>;

export type OperationalTaskHealthDb = {
  task: {
    findMany(args: {
      where: Prisma.TaskWhereInput;
      orderBy: Prisma.TaskOrderByWithRelationInput[];
      take: number;
      select: typeof taskHealthSelect;
    }): Promise<OperationalTaskHealthTask[]>;
  };
};

export type OperationalTaskHealthRef = {
  task_id: string;
  display_id: string | null;
  task_type: string;
  priority: string;
  due_at: string | null;
  action_href: string;
};

export type OperationalTaskHealthGroup = {
  key: string;
  label: string;
  count: number;
  urgent_count: number;
  high_count: number;
};

export type OperationalTaskHealthOrphanReason =
  | 'invalid_metadata_source'
  | 'invalid_risk_domain'
  | 'task_type_domain_mismatch'
  | 'missing_risk_key'
  | 'invalid_dedupe_key'
  | 'missing_owner_reference'
  | 'related_entity_mismatch';

export type OperationalTaskHealthBoard = {
  generated_at: string;
  scan: {
    statuses: Array<(typeof OPEN_TASK_STATUSES)[number]>;
    limit: number;
    scanned_count: number;
    truncated: boolean;
  };
  summary: {
    open_count: number;
    overdue_count: number;
    sla_overdue_count: number;
    unassigned_count: number;
    patient_safety_count: number;
    billing_close_count: number;
    report_delay_count: number;
    risk_task_count: number;
    stale_risk_task_count: number;
    orphan_risk_task_count: number;
  };
  task_type_groups: OperationalTaskHealthGroup[];
  risk_domain_groups: OperationalTaskHealthGroup[];
  orphan_audit: {
    checked_count: number;
    orphan_count: number;
    reasons: Array<{
      reason: OperationalTaskHealthOrphanReason;
      count: number;
    }>;
    tasks: OperationalTaskHealthRef[];
  };
  attention: {
    overdue_tasks: OperationalTaskHealthRef[];
    sla_overdue_tasks: OperationalTaskHealthRef[];
    unassigned_tasks: OperationalTaskHealthRef[];
    stale_risk_tasks: OperationalTaskHealthRef[];
  };
};

type BuildOperationalTaskHealthBoardArgs = {
  orgId: string;
  now?: Date;
  limit?: number;
  where?: Prisma.TaskWhereInput;
};

type RiskMetadata = {
  source: string | null;
  domain: RiskDomain | null;
  riskKey: string | null;
  caseId: string | null;
  patientId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  patientSafety: boolean;
  billingClose: boolean;
};

export function normalizeOperationalTaskHealthLimit(value: number | null | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_OPERATIONAL_TASK_HEALTH_LIMIT;
  return Math.min(
    MAX_OPERATIONAL_TASK_HEALTH_LIMIT,
    Math.max(1, Math.trunc(value ?? DEFAULT_OPERATIONAL_TASK_HEALTH_LIMIT)),
  );
}

export async function buildOperationalTaskHealthBoard(
  db: OperationalTaskHealthDb,
  args: BuildOperationalTaskHealthBoardArgs,
): Promise<OperationalTaskHealthBoard> {
  const now = args.now ?? new Date();
  const limit = normalizeOperationalTaskHealthLimit(args.limit);
  const tasks = await db.task.findMany({
    where: {
      org_id: args.orgId,
      status: { in: [...OPEN_TASK_STATUSES] },
      ...(args.where ?? {}),
    },
    orderBy: [
      { sla_due_at: 'asc' },
      { due_date: 'asc' },
      { priority: 'asc' },
      { updated_at: 'asc' },
      { id: 'desc' },
    ],
    take: limit + 1,
    select: taskHealthSelect,
  });
  const scanned = tasks.slice(0, limit);
  const annotated = scanned.map((task) => annotateTask(task, now));
  const riskTasks = annotated.filter((task) => task.isRiskTaskLike);
  const orphanTasks = riskTasks.filter((task) => task.orphanReasons.length > 0);

  return {
    generated_at: now.toISOString(),
    scan: {
      statuses: [...OPEN_TASK_STATUSES],
      limit,
      scanned_count: scanned.length,
      truncated: tasks.length > limit,
    },
    summary: {
      open_count: scanned.length,
      overdue_count: annotated.filter((task) => task.isOverdue).length,
      sla_overdue_count: annotated.filter((task) => task.isSlaOverdue).length,
      unassigned_count: annotated.filter((task) => task.isUnassigned).length,
      patient_safety_count: annotated.filter((task) => task.patientSafety).length,
      billing_close_count: annotated.filter((task) => task.billingClose).length,
      report_delay_count: annotated.filter((task) => task.riskDomain === 'report_delivery').length,
      risk_task_count: riskTasks.length,
      stale_risk_task_count: riskTasks.filter((task) => task.isStaleRiskTask).length,
      orphan_risk_task_count: orphanTasks.length,
    },
    task_type_groups: buildGroups(annotated, (task) => ({
      key: task.task.task_type,
      label: task.task.task_type,
    })),
    risk_domain_groups: buildGroups(
      riskTasks.filter((task) => task.riskDomain),
      (task) => ({
        key: task.riskDomain ?? 'unknown',
        label: task.riskDomain ? RISK_DOMAIN_LABELS[task.riskDomain] : '不明なリスク',
      }),
      RISK_DOMAIN_ORDER,
    ),
    orphan_audit: {
      checked_count: riskTasks.length,
      orphan_count: orphanTasks.length,
      reasons: countOrphanReasons(orphanTasks),
      tasks: orphanTasks.slice(0, 20).map((task) => toTaskRef(task.task, task.isSlaOverdue)),
    },
    attention: {
      overdue_tasks: annotated
        .filter((task) => task.isOverdue)
        .slice(0, 20)
        .map((task) => toTaskRef(task.task, task.isSlaOverdue)),
      sla_overdue_tasks: annotated
        .filter((task) => task.isSlaOverdue)
        .slice(0, 20)
        .map((task) => toTaskRef(task.task, true)),
      unassigned_tasks: annotated
        .filter((task) => task.isUnassigned)
        .slice(0, 20)
        .map((task) => toTaskRef(task.task, task.isSlaOverdue)),
      stale_risk_tasks: riskTasks
        .filter((task) => task.isStaleRiskTask)
        .slice(0, 20)
        .map((task) => toTaskRef(task.task, task.isSlaOverdue)),
    },
  };
}

function annotateTask(task: OperationalTaskHealthTask, now: Date) {
  const metadata = readRiskMetadata(task);
  const riskDomain = RISK_DOMAIN_BY_TASK_TYPE.get(task.task_type) ?? metadata.domain ?? undefined;
  const registryEntry = riskDomain ? RISK_TASK_REGISTRY[riskDomain] : null;
  const isRiskTaskLike = isRiskLikeTask(task, metadata);
  const orphanReasons = isRiskTaskLike ? auditRiskTask(task, metadata, riskDomain) : [];

  return {
    task,
    metadata,
    riskDomain,
    orphanReasons,
    isRiskTaskLike,
    isOverdue: Boolean(task.due_date && task.due_date.getTime() < now.getTime()),
    isSlaOverdue: Boolean(task.sla_due_at && task.sla_due_at.getTime() < now.getTime()),
    isUnassigned: !task.assigned_to,
    patientSafety: metadata.patientSafety || Boolean(registryEntry?.patient_safety),
    billingClose: metadata.billingClose || Boolean(registryEntry?.billing_close),
    isStaleRiskTask: isStaleRiskTask(task, registryEntry, now),
  };
}

function isRiskLikeTask(task: OperationalTaskHealthTask, metadata: RiskMetadata) {
  return (
    RISK_TASK_TYPES.has(task.task_type) ||
    task.dedupe_key?.startsWith('risk:') === true ||
    metadata.source === 'risk_finding' ||
    metadata.domain !== null
  );
}

function readRiskMetadata(task: OperationalTaskHealthTask): RiskMetadata {
  const metadata = readJsonObject(task.metadata);
  const domain = readRiskDomain(metadata?.risk_domain);
  return {
    source: readNonBlankString(metadata?.source),
    domain,
    riskKey: readNonBlankString(metadata?.risk_key),
    caseId: readNonBlankString(metadata?.case_id),
    patientId: readNonBlankString(metadata?.patient_id),
    relatedEntityType: readNonBlankString(metadata?.related_entity_type),
    relatedEntityId: readNonBlankString(metadata?.related_entity_id),
    patientSafety: metadata?.patient_safety === true,
    billingClose: metadata?.billing_close === true,
  };
}

function auditRiskTask(
  task: OperationalTaskHealthTask,
  metadata: RiskMetadata,
  riskDomain: RiskDomain | undefined,
): OperationalTaskHealthOrphanReason[] {
  const reasons: OperationalTaskHealthOrphanReason[] = [];
  const addReason = (reason: OperationalTaskHealthOrphanReason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (metadata.source !== 'risk_finding') addReason('invalid_metadata_source');
  if (!metadata.domain) addReason('invalid_risk_domain');
  if (metadata.domain && RISK_TASK_REGISTRY[metadata.domain].task_type !== task.task_type) {
    addReason('task_type_domain_mismatch');
  }
  if (riskDomain && RISK_TASK_REGISTRY[riskDomain].task_type !== task.task_type) {
    addReason('task_type_domain_mismatch');
  }
  if (!metadata.riskKey) addReason('missing_risk_key');
  if (!task.dedupe_key?.startsWith('risk:')) addReason('invalid_dedupe_key');
  if (!metadata.caseId && !metadata.patientId && !task.related_entity_id) {
    addReason('missing_owner_reference');
  }
  if (
    metadata.relatedEntityType &&
    metadata.relatedEntityId &&
    task.related_entity_type &&
    task.related_entity_id &&
    (metadata.relatedEntityType !== task.related_entity_type ||
      metadata.relatedEntityId !== task.related_entity_id)
  ) {
    addReason('related_entity_mismatch');
  }
  return reasons;
}

function isStaleRiskTask(
  task: OperationalTaskHealthTask,
  registryEntry: (typeof RISK_TASK_REGISTRY)[RiskDomain] | null,
  now: Date,
) {
  if (!registryEntry) return false;
  const ageMs = now.getTime() - task.updated_at.getTime();
  return ageMs > registryEntry.stale_threshold_days * 24 * 60 * 60 * 1000;
}

function buildGroups<T extends { task: Pick<OperationalTaskHealthTask, 'priority'> }>(
  tasks: T[],
  select: (task: T) => { key: string; label: string },
  preferredOrder: readonly string[] = [],
): OperationalTaskHealthGroup[] {
  const groups = new Map<string, OperationalTaskHealthGroup>();
  for (const task of tasks) {
    const { key, label } = select(task);
    const group = groups.get(key) ?? {
      key,
      label,
      count: 0,
      urgent_count: 0,
      high_count: 0,
    };
    group.count += 1;
    if (task.task.priority === 'urgent') group.urgent_count += 1;
    if (task.task.priority === 'high') group.high_count += 1;
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort(
    (left, right) =>
      preferredSortIndex(preferredOrder, left.key) -
        preferredSortIndex(preferredOrder, right.key) ||
      right.urgent_count - left.urgent_count ||
      right.high_count - left.high_count ||
      right.count - left.count ||
      left.key.localeCompare(right.key),
  );
}

function countOrphanReasons(tasks: Array<{ orphanReasons: OperationalTaskHealthOrphanReason[] }>) {
  const counts = new Map<OperationalTaskHealthOrphanReason, number>();
  for (const task of tasks) {
    for (const reason of task.orphanReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}

function toTaskRef(
  task: OperationalTaskHealthTask,
  isSlaOverdue: boolean,
): OperationalTaskHealthRef {
  return {
    task_id: task.id,
    display_id: task.display_id,
    task_type: task.task_type,
    priority: task.priority,
    due_at: (isSlaOverdue ? task.sla_due_at : task.due_date)?.toISOString() ?? null,
    action_href: `/tasks?status=open&task_type=${encodeURIComponent(task.task_type)}`,
  };
}

function preferredSortIndex(order: readonly string[], key: string) {
  const index = order.indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function readRiskDomain(value: unknown): RiskDomain | null {
  return typeof value === 'string' && RISK_DOMAIN_ORDER.includes(value as RiskDomain)
    ? (value as RiskDomain)
    : null;
}

function readNonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
