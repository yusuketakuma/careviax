import { prisma } from '@/lib/db/client';
import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';

export type HealthStatus = 'ok' | 'degraded' | 'down';

export type CheckResult = {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
};

type AwsClient<TResponse> = {
  send: (cmd: unknown, options?: { abortSignal?: AbortSignal }) => Promise<TResponse>;
};

type S3Module = {
  S3Client: new (config: { region: string; maxAttempts?: number }) => AwsClient<unknown>;
  HeadBucketCommand: new (input: { Bucket: string }) => unknown;
};

let cachedS3Module: Promise<S3Module> | null = null;
const s3Clients = new Map<string, AwsClient<unknown>>();

async function loadS3Module() {
  cachedS3Module ??= import('@aws-sdk/client-s3').then((module) => module as S3Module);
  return cachedS3Module;
}

async function getS3Client(region: string) {
  const cached = s3Clients.get(region);
  if (cached) return cached;
  const awsModule = await loadS3Module();
  const client = withAwsClientTimeout(new awsModule.S3Client({ region, ...awsClientConfig() }));
  s3Clients.set(region, client);
  return client;
}

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
    const { HeadBucketCommand } = await loadS3Module();
    const client = await getS3Client(region);
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
