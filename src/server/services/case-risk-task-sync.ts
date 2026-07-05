import {
  shouldCreateOperationalTaskForRisk,
  upsertOperationalTaskForRisk,
} from './risk-task-bridge';
import { getCaseRiskCockpit, type CaseRiskCockpitDb } from '@/server/services/case-risk-cockpit';
import type { MemberRole } from '@prisma/client';
import type { RiskFinding } from '@/lib/risk/risk-finding';

type RiskTaskSyncTx = Parameters<typeof upsertOperationalTaskForRisk>[0];

export type RiskTaskSyncTaskRef = {
  id: string;
  display_id: string | null;
};

export type RiskFindingTaskSyncResult = {
  taskable_finding_count: number;
  skipped_finding_count: number;
  upserted_task_count: number;
  upserted_tasks: RiskTaskSyncTaskRef[];
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
  tx: RiskTaskSyncTx,
  args: {
    orgId: string;
    findings: RiskFinding[];
  },
): Promise<RiskFindingTaskSyncResult> {
  const taskableFindings = args.findings.filter(shouldCreateOperationalTaskForRisk);
  const upsertedTasks: RiskTaskSyncTaskRef[] = [];

  for (const finding of taskableFindings) {
    const task = await upsertOperationalTaskForRisk(tx, {
      orgId: args.orgId,
      finding,
    });
    const ref = toTaskRef(task);
    if (ref) upsertedTasks.push(ref);
  }

  return {
    taskable_finding_count: taskableFindings.length,
    skipped_finding_count: args.findings.length - taskableFindings.length,
    upserted_task_count: upsertedTasks.length,
    upserted_tasks: upsertedTasks,
  };
}

export async function syncCaseRiskCockpitOperationalTasks(
  tx: CaseRiskCockpitDb & RiskTaskSyncTx,
  args: SyncCaseRiskTaskArgs,
): Promise<CaseRiskTaskSyncResult | null> {
  const cockpit = await getCaseRiskCockpit(tx, args);
  if (!cockpit) return null;

  const sync = await syncOperationalTasksForRiskFindings(tx, {
    orgId: args.orgId,
    findings: flattenCaseRiskFindings(cockpit.sections),
  });

  return {
    generated_at: cockpit.generated_at,
    case_id: cockpit.case.id,
    patient_id: cockpit.patient.id,
    overall_status: cockpit.overall.status,
    ...sync,
  };
}
