import { prisma } from '@/lib/db/client';

export type HealthStatus = 'ok' | 'degraded' | 'down';

export type CheckResult = {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
};

/**
 * Check database connectivity by running a simple query.
 */
export async function checkDatabase(): Promise<CheckResult> {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'down',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check S3 connectivity by issuing a HeadBucket request.
 * Skipped when AWS credentials or bucket name are not configured.
 */
export async function checkS3(): Promise<CheckResult> {
  const bucketName = process.env.S3_BUCKET_NAME;
  const region = process.env.S3_BUCKET_REGION ?? process.env.AWS_REGION;

  if (!bucketName || !region) {
    return { status: 'ok', message: 'S3 env not configured — skipped' };
  }

  try {
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region });
    const start = Date.now();
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'down',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run all health checks and return an aggregated result.
 */
export async function runHealthChecks(): Promise<{
  overall: HealthStatus;
  checks: Record<string, CheckResult>;
}> {
  const [database, s3] = await Promise.all([checkDatabase(), checkS3()]);
  const checks: Record<string, CheckResult> = { database, s3 };

  let overall: HealthStatus = 'ok';
  for (const result of Object.values(checks)) {
    if (result.status === 'down') {
      overall = 'down';
      break;
    }
    if (result.status === 'degraded') {
      overall = 'degraded';
    }
  }

  return { overall, checks };
}
