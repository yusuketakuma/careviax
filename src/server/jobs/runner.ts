import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export async function runJob(
  jobType: string,
  fn: () => Promise<{ processedCount: number; errors?: string[] }>,
  orgId?: string,
  dedupeKey?: string
) {
  const job = await prisma.integrationJob.create({
    data: {
      job_type: jobType,
      dedupe_key: dedupeKey ?? null,
      status: 'running',
      org_id: orgId,
      run_at: new Date(),
      locked_at: new Date(),
      started_at: new Date(),
    },
  });

  try {
    const result = await fn();
    await prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        output: result as unknown as Prisma.InputJsonValue,
        completed_at: new Date(),
        locked_at: null,
      },
    });
    return result;
  } catch (error) {
    await prisma.integrationJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        error_log: error instanceof Error ? error.message : String(error),
        completed_at: new Date(),
        locked_at: null,
        retry_count: { increment: 1 },
      },
    });
    throw error;
  }
}
