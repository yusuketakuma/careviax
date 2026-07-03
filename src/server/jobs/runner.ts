import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { dispatchNotificationEvent } from '@/server/services/notifications';

const MAX_RETRIES = 3;
const JOB_EXECUTION_FAILED_MESSAGE = 'Job execution failed';
const JOB_EXECUTION_FAILED_NOTIFICATION_MESSAGE = 'ジョブの実行に失敗しました';
// Structured-log event name for permanent job failures. Kept stable because the
// CloudWatch Logs metric filter in tools/infra/cloudwatch-alarms.json keys off it.
const JOB_EXECUTION_FAILED_LOG_EVENT = 'job.execution_failed';
// Notification event type used to route admin-facing job-failure alerts through the
// shared delivery pipeline (in-app + web-push). No notificationRule config is
// required: recipients are supplied explicitly as admin/owner user ids per org.
const JOB_FAILURE_NOTIFICATION_EVENT_TYPE = 'job_execution_failed';
const DEFAULT_JOB_STALE_LOCK_MS = 6 * 60 * 60 * 1000;
const MAX_JOB_STALE_LOCK_MS = 24 * 60 * 60 * 1000;
type RunJobResult =
  | { processedCount: number; errors?: string[] }
  | { processedCount: 0; skipped: true };
const activeJobRuns = new Map<string, Promise<RunJobResult>>();

function resolveJobStaleLockMs(value: string | undefined = process.env.JOB_STALE_LOCK_MS) {
  const parsed = Number(value ?? DEFAULT_JOB_STALE_LOCK_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_JOB_STALE_LOCK_MS;
  const normalized = Math.trunc(parsed);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) return DEFAULT_JOB_STALE_LOCK_MS;
  return Math.min(normalized, MAX_JOB_STALE_LOCK_MS);
}

/**
 * Concurrency guard: ensure only one job of the same type runs at a time.
 * Returns true if a running job already exists (caller should skip/abort).
 */
async function isJobAlreadyRunning(jobType: string, orgId?: string): Promise<boolean> {
  const lockedAfter = new Date(Date.now() - resolveJobStaleLockMs());
  const existing = await prisma.integrationJob.findFirst({
    where: {
      job_type: jobType,
      status: 'running',
      ...(orgId ? { org_id: orgId } : {}),
      OR: [{ locked_at: null }, { locked_at: { gt: lockedAfter } }],
    },
    select: { id: true },
  });
  return existing !== null;
}

function jobRunKey(jobType: string, orgId?: string, dedupeKey?: string) {
  return `${orgId ?? 'global'}:${jobType}:${dedupeKey ?? 'singleton'}`;
}

async function runJobOnce(
  jobType: string,
  fn: () => Promise<{ processedCount: number; errors?: string[] }>,
  orgId?: string,
  dedupeKey?: string,
): Promise<RunJobResult> {
  // Skip if the same job type is already in progress
  if (await isJobAlreadyRunning(jobType, orgId)) {
    logger.warn({
      event: 'job.duplicate_running_skipped',
      jobType,
      operation: 'run_job',
      code: 'JOB_ALREADY_RUNNING',
      ...(orgId ? { orgId } : {}),
    });
    return { processedCount: 0, skipped: true };
  }

  const job = await prisma.integrationJob.create({
    data: {
      job_type: jobType,
      dedupe_key: dedupeKey ?? null,
      status: 'running',
      org_id: orgId,
      max_retries: MAX_RETRIES,
      run_at: new Date(),
      locked_at: new Date(),
      started_at: new Date(),
    },
  });

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fn();
      await prisma.integrationJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          output: toPrismaJsonInput(result),
          completed_at: new Date(),
          locked_at: null,
          retry_count: attempt,
        },
      });
      return result;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        // Update retry count and continue to next attempt
        await prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            retry_count: attempt + 1,
            error_log: `Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${JOB_EXECUTION_FAILED_MESSAGE}`,
          },
        });
        continue;
      }

      // All retries exhausted — mark as failed.
      // Wrap cleanup in its own try/catch so a transient DB error here cannot
      // (a) leave the row stuck as 'running' silently while still throwing the
      // wrong error upstream, nor (b) overwrite the original failure.
      try {
        await prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            error_log: `All ${MAX_RETRIES} retries exhausted. Last error: ${JOB_EXECUTION_FAILED_MESSAGE}`,
            completed_at: new Date(),
            locked_at: null,
            retry_count: attempt + 1,
          },
        });
      } catch (cleanupError) {
        logger.error(
          {
            event: 'job.cleanup_status_persist_failed',
            jobType,
            operation: 'mark_job_failed_after_retries',
            code: 'JOB_CLEANUP_FAILED',
            entityType: 'integration_job',
            entityId: job.id,
            attempt: attempt + 1,
            ...(orgId ? { orgId } : {}),
          },
          cleanupError,
        );
        // Intentionally NOT overwriting lastError — caller must see the original failure.
      }

      // Structured failure log for CloudWatch. Emitted before notification so the
      // metric fires even if the human-reach delivery below fails. Raw error detail
      // is intentionally omitted — logger only records the sanitized error name.
      logger.error(
        {
          event: JOB_EXECUTION_FAILED_LOG_EVENT,
          jobType,
          operation: 'run_job',
          code: 'JOB_RETRIES_EXHAUSTED',
          attempt: attempt + 1,
          ...(orgId ? { orgId } : {}),
        },
        error,
      );

      // Notify admin users about the failure (already self-protected internally).
      await notifyAdminsOfJobFailure(jobType, orgId);
    }
  }

  throw lastError;
}

export async function runJob(
  jobType: string,
  fn: () => Promise<{ processedCount: number; errors?: string[] }>,
  orgId?: string,
  dedupeKey?: string,
): Promise<RunJobResult> {
  const activeKey = jobRunKey(jobType, orgId, dedupeKey);
  if (activeJobRuns.has(activeKey)) {
    logger.warn({
      event: 'job.duplicate_in_process_skipped',
      jobType,
      operation: 'run_job',
      code: 'JOB_IN_PROCESS_ALREADY_RUNNING',
      ...(orgId ? { orgId } : {}),
    });
    return { processedCount: 0, skipped: true };
  }

  const run = runJobOnce(jobType, fn, orgId, dedupeKey).finally(() => {
    activeJobRuns.delete(activeKey);
  });
  activeJobRuns.set(activeKey, run);
  return run;
}

/**
 * Notify admin/owner users when a job permanently fails.
 *
 * Routes through {@link dispatchNotificationEvent} so the failure reaches a human
 * off-dashboard: it persists the in-app notification AND fans out to web-push
 * subscriptions (the shared pipeline's real delivery path). Admins are supplied as
 * explicit recipients per org, so no notificationRule config is required.
 *
 * Best-effort: any delivery error is swallowed (logged) and never masks the
 * original job failure the caller must surface.
 */
async function notifyAdminsOfJobFailure(jobType: string, orgId?: string) {
  try {
    const membershipFilter: Prisma.MembershipWhereInput = {
      role: { in: ['admin', 'owner'] },
      is_active: true,
    };
    if (orgId) {
      membershipFilter.org_id = orgId;
    }

    const adminMemberships = await prisma.membership.findMany({
      where: membershipFilter,
      select: { user_id: true, org_id: true },
    });
    if (adminMemberships.length === 0) {
      return;
    }

    const dedupeKey = `job-failure:${jobType}:${new Date().toISOString().slice(0, 10)}`;
    const message = `ジョブ「${jobType}」が${MAX_RETRIES}回リトライ後に失敗しました: ${JOB_EXECUTION_FAILED_NOTIFICATION_MESSAGE}`;

    // Group admins by org: dispatch + web-push run inside a single org's RLS scope.
    const adminUserIdsByOrg = new Map<string, string[]>();
    for (const membership of adminMemberships) {
      const existing = adminUserIdsByOrg.get(membership.org_id);
      if (existing) {
        existing.push(membership.user_id);
      } else {
        adminUserIdsByOrg.set(membership.org_id, [membership.user_id]);
      }
    }

    for (const [dispatchOrgId, adminUserIds] of adminUserIdsByOrg) {
      try {
        await withOrgContext(dispatchOrgId, (tx) =>
          dispatchNotificationEvent(tx, {
            orgId: dispatchOrgId,
            eventType: JOB_FAILURE_NOTIFICATION_EVENT_TYPE,
            type: 'urgent',
            title: 'ジョブ実行失敗',
            message,
            link: '/admin/jobs',
            explicitUserIds: adminUserIds,
            dedupeKey,
          }),
        );
      } catch (deliveryError) {
        // One org's delivery failure must not block the others or the caller.
        logger.error(
          {
            event: 'job.failure_notification_delivery_failed',
            jobType,
            operation: 'notify_admins_of_job_failure',
            code: 'JOB_FAILURE_NOTIFICATION_DELIVERY_FAILED',
            orgId: dispatchOrgId,
          },
          deliveryError,
        );
      }
    }
  } catch (notificationError) {
    // Notification failure should not mask the original job error
    logger.error(
      {
        event: 'job.failure_notification_failed',
        jobType,
        operation: 'notify_admins_of_job_failure',
        code: 'JOB_FAILURE_NOTIFICATION_FAILED',
        ...(orgId ? { orgId } : {}),
      },
      notificationError,
    );
  }
}
