import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';

const MAX_RETRIES = 3;
const JOB_EXECUTION_FAILED_MESSAGE = 'Job execution failed';
const JOB_CLEANUP_FAILED_MESSAGE = 'Job cleanup failed';
const JOB_EXECUTION_FAILED_NOTIFICATION_MESSAGE = 'ジョブの実行に失敗しました';
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
    console.warn(`[runner] Skipping duplicate job execution: ${jobType} (already running)`);
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
        const cleanupKind = cleanupError instanceof Error ? 'Error' : typeof cleanupError;
        const originalKind = error instanceof Error ? 'Error' : typeof error;
        console.error(
          `[runner] CRITICAL: failed to mark job ${job.id} (${jobType}) as 'failed' after retries exhausted. ` +
            `Row may remain 'running' and block future runs. ${JOB_CLEANUP_FAILED_MESSAGE}. ` +
            `Original error: ${JOB_EXECUTION_FAILED_MESSAGE}. Cleanup kind: ${cleanupKind}. ` +
            `Original kind: ${originalKind}`,
        );
        // Intentionally NOT overwriting lastError — caller must see the original failure.
      }

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
    console.warn(`[runner] Skipping duplicate in-process job execution: ${jobType}`);
    return { processedCount: 0, skipped: true };
  }

  const run = runJobOnce(jobType, fn, orgId, dedupeKey).finally(() => {
    activeJobRuns.delete(activeKey);
  });
  activeJobRuns.set(activeKey, run);
  return run;
}

/**
 * Create notifications for all admin users when a job permanently fails.
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
    const dedupeKey = `job-failure:${jobType}:${new Date().toISOString().slice(0, 10)}`;
    const message = `ジョブ「${jobType}」が${MAX_RETRIES}回リトライ後に失敗しました: ${JOB_EXECUTION_FAILED_NOTIFICATION_MESSAGE}`;

    await prisma.notification.createMany({
      data: adminMemberships.map((m) => ({
        org_id: m.org_id,
        user_id: m.user_id,
        type: 'urgent' as const,
        title: 'ジョブ実行失敗',
        message,
        link: '/admin/jobs',
        dedupe_key: dedupeKey,
      })),
      skipDuplicates: true,
    });
  } catch {
    // Notification failure should not mask the original job error
    console.error(`[runner] Failed to notify admins about job failure: ${jobType}`);
  }
}
