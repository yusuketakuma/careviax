import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

const MAX_RETRIES = 3;

/**
 * Concurrency guard: ensure only one job of the same type runs at a time.
 * Returns true if a running job already exists (caller should skip/abort).
 */
async function isJobAlreadyRunning(jobType: string, orgId?: string): Promise<boolean> {
  const existing = await prisma.integrationJob.findFirst({
    where: {
      job_type: jobType,
      status: 'running',
      ...(orgId ? { org_id: orgId } : {}),
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function runJob(
  jobType: string,
  fn: () => Promise<{ processedCount: number; errors?: string[] }>,
  orgId?: string,
  dedupeKey?: string
) {
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
          output: result as unknown as Prisma.InputJsonValue,
          completed_at: new Date(),
          locked_at: null,
          retry_count: attempt,
        },
      });
      return result;
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (attempt < MAX_RETRIES) {
        // Update retry count and continue to next attempt
        await prisma.integrationJob.update({
          where: { id: job.id },
          data: {
            retry_count: attempt + 1,
            error_log: `Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${errorMessage}`,
          },
        });
        continue;
      }

      // All retries exhausted — mark as failed
      await prisma.integrationJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error_log: `All ${MAX_RETRIES} retries exhausted. Last error: ${errorMessage}`,
          completed_at: new Date(),
          locked_at: null,
          retry_count: attempt + 1,
        },
      });

      // Notify admin users about the failure
      await notifyAdminsOfJobFailure(jobType, errorMessage, orgId);
    }
  }

  throw lastError;
}

/**
 * Create notifications for all admin users when a job permanently fails.
 */
async function notifyAdminsOfJobFailure(
  jobType: string,
  errorMessage: string,
  orgId?: string
) {
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
    const admins = adminMemberships.map((m) => ({ id: m.user_id, org_id: m.org_id }));

    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          org_id: admin.org_id,
          user_id: admin.id,
          type: 'urgent',
          title: 'ジョブ実行失敗',
          message: `ジョブ「${jobType}」が${MAX_RETRIES}回リトライ後に失敗しました: ${errorMessage.slice(0, 200)}`,
          link: '/admin/jobs',
          dedupe_key: `job-failure:${jobType}:${new Date().toISOString().slice(0, 10)}`,
        },
      });
    }
  } catch {
    // Notification failure should not mask the original job error
    console.error(`[runner] Failed to notify admins about job failure: ${jobType}`);
  }
}
