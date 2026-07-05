import {
  riskFindingToOperationalTaskInput,
  shouldCreateOperationalTaskForRisk,
  upsertOperationalTaskForRisk,
} from './risk-task-bridge';
import { RISK_TASK_REGISTRY } from '@/lib/tasks/task-registry';
import { getCaseRiskCockpit, type CaseRiskCockpitDb } from '@/server/services/case-risk-cockpit';
import type { MemberRole } from '@prisma/client';
import type { RiskFinding } from '@/lib/risk/risk-finding';

type RiskTaskSyncTx = Parameters<typeof upsertOperationalTaskForRisk>[0];
type RiskTaskCloseTx = RiskTaskSyncTx & {
  task: RiskTaskSyncTx['task'] & {
    findMany(args: unknown): Promise<OpenRiskTaskRow[]>;
  };
};

type OpenRiskTaskRow = {
  id: string;
  display_id: string | null;
  dedupe_key: string | null;
};

const MANAGED_RISK_TASK_TYPES = Object.values(RISK_TASK_REGISTRY).map((entry) => entry.task_type);
const RISK_TASK_METADATA_SCOPE = { path: ['source'], equals: 'risk_finding' } as const;

function caseRiskTaskOwnershipWhere(args: { orgId: string; caseId: string }) {
  return {
    org_id: args.orgId,
    status: { in: ['pending', 'in_progress'] },
    task_type: { in: MANAGED_RISK_TASK_TYPES },
    dedupe_key: { startsWith: 'risk:' },
    AND: [
      {
        metadata: {
          path: ['case_id'],
          equals: args.caseId,
        },
      },
      {
        metadata: RISK_TASK_METADATA_SCOPE,
      },
    ],
  };
}

export type RiskTaskSyncTaskRef = {
  id: string;
  display_id: string | null;
};

export type RiskFindingTaskSyncResult = {
  taskable_finding_count: number;
  skipped_finding_count: number;
  upserted_task_count: number;
  upserted_tasks: RiskTaskSyncTaskRef[];
  resolved_stale_task_count: number;
  resolved_stale_tasks: RiskTaskSyncTaskRef[];
};

export type CaseRiskTaskSyncResult = RiskFindingTaskSyncResult & {
  generated_at: string;
  case_id: string;
  patient_id: string;
  overall_status: string;
};

type SyncCaseRiskTaskArgs = {
  orgId: string;
  caseId: string;
  userId: string;
  role: MemberRole;
  now?: Date;
};

function toTaskRef(value: unknown): RiskTaskSyncTaskRef | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { id?: unknown; display_id?: unknown };
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    display_id: typeof row.display_id === 'string' ? row.display_id : null,
  };
}

export function flattenCaseRiskFindings(
  sections: Array<{ findings: RiskFinding[] }>,
): RiskFinding[] {
  return sections.flatMap((section) => section.findings);
}

export async function syncOperationalTasksForRiskFindings(
  tx: RiskTaskCloseTx,
  args: {
    orgId: string;
    caseId?: string | null;
    findings: RiskFinding[];
    resolveStale?: boolean;
  },
): Promise<RiskFindingTaskSyncResult> {
  const taskableInputs = args.findings
    .filter(shouldCreateOperationalTaskForRisk)
    .map((finding) => ({
      finding,
      taskInput: riskFindingToOperationalTaskInput({ orgId: args.orgId, finding }),
    }))
    .filter(
      (
        entry,
      ): entry is {
        finding: RiskFinding;
        taskInput: NonNullable<ReturnType<typeof riskFindingToOperationalTaskInput>>;
      } => Boolean(entry.taskInput),
    );
  const upsertedTasks: RiskTaskSyncTaskRef[] = [];

  for (const { finding } of taskableInputs) {
    const task = await upsertOperationalTaskForRisk(tx, {
      orgId: args.orgId,
      finding,
    });
    const ref = toTaskRef(task);
    if (ref) upsertedTasks.push(ref);
  }

  const stale = args.resolveStale
    ? await resolveStaleOperationalTasksForCaseRisk(tx, {
        orgId: args.orgId,
        caseId: args.caseId,
        activeDedupeKeys: new Set(
          taskableInputs
            .map(({ taskInput }) => taskInput.dedupeKey)
            .filter((key): key is string => Boolean(key)),
        ),
      })
    : { resolved_stale_task_count: 0, resolved_stale_tasks: [] };

  return {
    taskable_finding_count: taskableInputs.length,
    skipped_finding_count: args.findings.length - taskableInputs.length,
    upserted_task_count: upsertedTasks.length,
    upserted_tasks: upsertedTasks,
    ...stale,
  };
}

export async function syncCaseRiskCockpitOperationalTasks(
  tx: CaseRiskCockpitDb & RiskTaskCloseTx,
  args: SyncCaseRiskTaskArgs,
): Promise<CaseRiskTaskSyncResult | null> {
  const cockpit = await getCaseRiskCockpit(tx, args);
  if (!cockpit) return null;

  const sync = await syncOperationalTasksForRiskFindings(tx, {
    orgId: args.orgId,
    caseId: cockpit.case.id,
    findings: flattenCaseRiskFindings(cockpit.sections),
    resolveStale: true,
  });

  return {
    generated_at: cockpit.generated_at,
    case_id: cockpit.case.id,
    patient_id: cockpit.patient.id,
    overall_status: cockpit.overall.status,
    ...sync,
  };
}

export async function resolveStaleOperationalTasksForCaseRisk(
  tx: RiskTaskCloseTx,
  args: {
    orgId: string;
    caseId?: string | null;
    activeDedupeKeys: ReadonlySet<string>;
  },
) {
  if (!args.caseId) {
    return { resolved_stale_task_count: 0, resolved_stale_tasks: [] as RiskTaskSyncTaskRef[] };
  }

  const openRiskTasks = await tx.task.findMany({
    where: caseRiskTaskOwnershipWhere({ orgId: args.orgId, caseId: args.caseId }),
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      display_id: true,
      dedupe_key: true,
    },
  });

  const staleTasks = openRiskTasks.filter(
    (task) => task.dedupe_key && !args.activeDedupeKeys.has(task.dedupe_key),
  );
  if (staleTasks.length === 0) {
    return { resolved_stale_task_count: 0, resolved_stale_tasks: [] as RiskTaskSyncTaskRef[] };
  }

  const resolvedTasks: RiskTaskSyncTaskRef[] = [];
  for (const task of staleTasks) {
    if (!task.dedupe_key) continue;
    const result = await tx.task.updateMany({
      where: {
        ...caseRiskTaskOwnershipWhere({ orgId: args.orgId, caseId: args.caseId }),
        id: task.id,
        dedupe_key: task.dedupe_key,
      },
      data: {
        status: 'completed',
        completed_at: new Date(),
      },
    });
    if (
      typeof result === 'object' &&
      result !== null &&
      'count' in result &&
      typeof result.count === 'number' &&
      result.count > 0
    ) {
      resolvedTasks.push({
        id: task.id,
        display_id: task.display_id,
      });
    }
  }

  return {
    resolved_stale_task_count: resolvedTasks.length,
    resolved_stale_tasks: resolvedTasks,
  };
}
