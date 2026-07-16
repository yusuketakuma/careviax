import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { syncCaseRiskCockpitOperationalTasks } from '@/server/services/case-risk-task-sync';
import { runJob } from '../runner';
import { listOrganizationIds } from '../organization-iteration';

export const DAILY_CASE_RISK_TASK_SYNC_JOB_TYPE = 'daily-case-risk-task-sync';
export const CASE_RISK_TASK_SYNC_SYSTEM_USER_ID = 'system:case-risk-task-sync';
const DEFAULT_CASE_RISK_TASK_SYNC_LIMIT = 100;
const MAX_CASE_RISK_TASK_SYNC_LIMIT = 500;
const CASE_RISK_TASK_SYNC_STATUSES = ['assessment', 'active', 'on_hold'] as const;

export type CaseRiskTaskSyncJobOptions = {
  orgId?: string;
  limit?: number;
  now?: Date;
};

export type CaseRiskTaskSyncJobResult = {
  processedCount: number;
  scannedCount: number;
  upsertedTaskCount: number;
  resolvedStaleTaskCount: number;
  taskableFindingCount: number;
  skippedFindingCount: number;
  skippedCaseCount: number;
  errorCount: number;
  limited: boolean;
  limit: number;
};

type CaseRiskTaskSyncRunResult =
  | CaseRiskTaskSyncJobResult
  | {
      processedCount: 0;
      skipped: true;
    };

export function resolveCaseRiskTaskSyncLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_CASE_RISK_TASK_SYNC_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_CASE_RISK_TASK_SYNC_LIMIT;
  const normalized = Math.trunc(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return DEFAULT_CASE_RISK_TASK_SYNC_LIMIT;
  }
  return Math.min(normalized, MAX_CASE_RISK_TASK_SYNC_LIMIT);
}

export async function syncCaseRiskCockpitRiskTasks(
  options: CaseRiskTaskSyncJobOptions = {},
): Promise<CaseRiskTaskSyncRunResult> {
  const limit = resolveCaseRiskTaskSyncLimit(options.limit);

  return runJob(
    DAILY_CASE_RISK_TASK_SYNC_JOB_TYPE,
    async () => {
      const result: CaseRiskTaskSyncJobResult = {
        processedCount: 0,
        scannedCount: 0,
        upsertedTaskCount: 0,
        resolvedStaleTaskCount: 0,
        taskableFindingCount: 0,
        skippedFindingCount: 0,
        skippedCaseCount: 0,
        errorCount: 0,
        limited: false,
        limit,
      };

      const orgIds = options.orgId ? [options.orgId] : await listOrganizationIds(prisma);
      const casesToSync: Array<{ id: string; org_id: string }> = [];
      for (const orgId of orgIds) {
        let cursor: string | undefined;
        for (;;) {
          const cases = await withOrgContext(orgId, (tx) =>
            tx.careCase.findMany({
              where: {
                org_id: orgId,
                status: { in: [...CASE_RISK_TASK_SYNC_STATUSES] },
              },
              orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
              take: limit,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
              select: {
                id: true,
                org_id: true,
              },
            }),
          );
          if (cases.length === 0) break;
          result.scannedCount += cases.length;
          casesToSync.push(...cases);

          if (cases.length < limit) break;
          cursor = cases.at(-1)?.id;
        }
      }

      for (const careCase of casesToSync) {
        try {
          const syncResult = await withOrgContext(careCase.org_id, (tx) =>
            syncCaseRiskCockpitOperationalTasks(tx, {
              orgId: careCase.org_id,
              caseId: careCase.id,
              userId: CASE_RISK_TASK_SYNC_SYSTEM_USER_ID,
              role: 'admin',
              now: options.now,
            }),
          );

          if (!syncResult) {
            result.skippedCaseCount += 1;
            continue;
          }

          result.processedCount += 1;
          result.upsertedTaskCount += syncResult.upserted_task_count;
          result.resolvedStaleTaskCount += syncResult.resolved_stale_task_count;
          result.taskableFindingCount += syncResult.taskable_finding_count;
          result.skippedFindingCount += syncResult.skipped_finding_count;
        } catch {
          result.errorCount += 1;
          logger.warn({
            event: 'case_risk_task_sync.case_failed',
            operation: 'sync_case_risk_task_batch',
            code: 'CASE_RISK_TASK_SYNC_CASE_FAILED',
            orgId: careCase.org_id,
          });
        }
      }

      return result;
    },
    options.orgId,
  ) as Promise<CaseRiskTaskSyncRunResult>;
}
