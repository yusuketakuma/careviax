/**
 * Backup monitoring helpers for RDS snapshots and S3 versioning.
 * Gracefully skipped when AWS SDK credentials are not configured.
 */

import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';

export type BackupCheckResult = {
  status: 'ok' | 'warning' | 'error' | 'skipped';
  message: string;
  details?: Record<string, unknown>;
};

export type BackupMonitorLogger = {
  error?: (...args: unknown[]) => void;
};

type BackupMonitorOptions = {
  logger?: BackupMonitorLogger;
};

type AwsClient<TResponse> = {
  send: (cmd: unknown, options?: { abortSignal?: AbortSignal }) => Promise<TResponse>;
};

type AwsClientConfig = {
  region: string;
  maxAttempts?: number;
};

type RdsSnapshotsResponse = {
  DBSnapshots?: Array<{
    DBSnapshotIdentifier?: string;
    SnapshotCreateTime?: Date;
  }>;
};

type RdsModule = {
  RDSClient: new (config: AwsClientConfig) => AwsClient<RdsSnapshotsResponse>;
  DescribeDBSnapshotsCommand: new (input: {
    DBInstanceIdentifier: string;
    SnapshotType: string;
  }) => unknown;
};

type S3VersioningResponse = {
  Status?: string;
};

type S3LifecycleResponse = {
  Rules?: Array<{
    Status?: string;
    Transitions?: Array<{ StorageClass?: string }>;
    Expiration?: { Days?: number };
  }>;
};

type S3Module = {
  S3Client: new (config: AwsClientConfig) => AwsClient<S3VersioningResponse | S3LifecycleResponse>;
  GetBucketVersioningCommand: new (input: { Bucket: string }) => unknown;
  GetBucketLifecycleConfigurationCommand: new (input: { Bucket: string }) => unknown;
};

type CognitoResponse = {
  UserPool?: {
    UserPoolAddOns?: {
      AdvancedSecurityMode?: string;
    };
  };
};

type CognitoModule = {
  CognitoIdentityProviderClient: new (config: AwsClientConfig) => AwsClient<CognitoResponse>;
  DescribeUserPoolCommand: new (input: { UserPoolId: string }) => unknown;
};

let cachedRdsModule: Promise<RdsModule | null> | null = null;
let cachedS3Module: Promise<S3Module> | null = null;
let cachedCognitoModule: Promise<CognitoModule> | null = null;
const rdsClients = new Map<string, AwsClient<RdsSnapshotsResponse>>();
const s3Clients = new Map<string, AwsClient<S3VersioningResponse | S3LifecycleResponse>>();
const cognitoClients = new Map<string, AwsClient<CognitoResponse>>();

function logBackupMonitorError(
  options: BackupMonitorOptions | undefined,
  message: string,
  err: unknown,
) {
  (options?.logger?.error ?? console.error)(message, err);
}

async function loadRdsModule() {
  if (!cachedRdsModule) {
    cachedRdsModule = import('@aws-sdk/client-rds')
      .then((module) => module as RdsModule)
      .catch(() => null);
  }
  return cachedRdsModule;
}

async function loadS3Module() {
  cachedS3Module ??= import('@aws-sdk/client-s3').then((module) => module as S3Module);
  return cachedS3Module;
}

async function loadCognitoModule() {
  cachedCognitoModule ??= import('@aws-sdk/client-cognito-identity-provider').then(
    (module) => module as CognitoModule,
  );
  return cachedCognitoModule;
}

async function getRdsClient(region: string) {
  const cached = rdsClients.get(region);
  if (cached) return cached;
  const awsModule = await loadRdsModule();
  if (!awsModule) return null;
  const client = withAwsClientTimeout(new awsModule.RDSClient({ region, ...awsClientConfig() }));
  rdsClients.set(region, client);
  return client;
}

async function getS3Client(region: string) {
  const cached = s3Clients.get(region);
  if (cached) return cached;
  const awsModule = await loadS3Module();
  const client = withAwsClientTimeout(new awsModule.S3Client({ region, ...awsClientConfig() }));
  s3Clients.set(region, client);
  return client;
}

async function getCognitoClient(region: string) {
  const cached = cognitoClients.get(region);
  if (cached) return cached;
  const awsModule = await loadCognitoModule();
  const client = withAwsClientTimeout(
    new awsModule.CognitoIdentityProviderClient({ region, ...awsClientConfig() }),
  );
  cognitoClients.set(region, client);
  return client;
}

/**
 * Check latest RDS automated snapshot age.
 * Returns warning if the latest snapshot is older than 26 hours (allowing buffer over 24h cycle).
 */
export async function checkRdsSnapshot(
  options: BackupMonitorOptions = {},
): Promise<BackupCheckResult> {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1';
  const dbInstanceId = process.env.RDS_DB_INSTANCE_ID;

  if (!dbInstanceId) {
    return { status: 'skipped', message: 'RDS_DB_INSTANCE_ID not configured' };
  }

  try {
    const rdsModule = await loadRdsModule();
    const client = await getRdsClient(region);
    if (!rdsModule || !client) {
      return { status: 'skipped', message: '@aws-sdk/client-rds not installed' };
    }

    const response = await client.send(
      new rdsModule.DescribeDBSnapshotsCommand({
        DBInstanceIdentifier: dbInstanceId,
        SnapshotType: 'automated',
      }),
    );

    const snapshots = response.DBSnapshots ?? [];
    if (snapshots.length === 0) {
      return { status: 'warning', message: 'No automated snapshots found' };
    }

    // Sort by creation time descending
    const sorted = [...snapshots].sort(
      (a, b) => (b.SnapshotCreateTime?.getTime() ?? 0) - (a.SnapshotCreateTime?.getTime() ?? 0),
    );

    const latest = sorted[0];
    const ageMs = Date.now() - (latest.SnapshotCreateTime?.getTime() ?? 0);
    const ageHours = ageMs / (1000 * 60 * 60);
    const maxAgeHours = 26;

    if (ageHours > maxAgeHours) {
      return {
        status: 'warning',
        message: `Latest snapshot is ${Math.round(ageHours)}h old (threshold: ${maxAgeHours}h)`,
        details: {
          snapshotId: latest.DBSnapshotIdentifier,
          createdAt: latest.SnapshotCreateTime?.toISOString(),
        },
      };
    }

    return {
      status: 'ok',
      message: `Latest snapshot: ${Math.round(ageHours)}h ago`,
      details: {
        snapshotId: latest.DBSnapshotIdentifier,
        createdAt: latest.SnapshotCreateTime?.toISOString(),
      },
    };
  } catch (err) {
    logBackupMonitorError(options, '[backup-monitor] RDS snapshot check failed:', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check that S3 bucket versioning is enabled.
 */
export async function checkS3Versioning(
  options: BackupMonitorOptions = {},
): Promise<BackupCheckResult> {
  const bucketName = process.env.S3_BUCKET_NAME;
  const region = process.env.S3_BUCKET_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-1';

  if (!bucketName) {
    return { status: 'skipped', message: 'S3_BUCKET_NAME not configured' };
  }

  try {
    const { GetBucketVersioningCommand } = await loadS3Module();
    const client = await getS3Client(region);
    const response = (await client.send(
      new GetBucketVersioningCommand({ Bucket: bucketName }),
    )) as S3VersioningResponse;

    const versioningStatus = response.Status;
    if (versioningStatus === 'Enabled') {
      return { status: 'ok', message: 'S3 versioning is enabled' };
    }

    return {
      status: 'warning',
      message: `S3 versioning status: ${versioningStatus ?? 'not configured'}`,
      details: { bucket: bucketName, versioningStatus },
    };
  } catch (err) {
    logBackupMonitorError(options, '[backup-monitor] S3 versioning check failed:', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check that the audit log archive bucket has an active lifecycle rule
 * transitioning audit logs to Glacier/Deep Archive and retaining them for 5 years.
 */
export async function checkAuditLogArchivePolicy(
  options: BackupMonitorOptions = {},
): Promise<BackupCheckResult> {
  const bucketName = process.env.AUDIT_LOG_ARCHIVE_BUCKET_NAME ?? process.env.S3_BUCKET_NAME;
  const region =
    process.env.AUDIT_LOG_ARCHIVE_BUCKET_REGION ??
    process.env.S3_BUCKET_REGION ??
    process.env.AWS_REGION ??
    'ap-northeast-1';

  if (!bucketName) {
    return { status: 'skipped', message: 'Audit archive bucket not configured' };
  }

  try {
    const { GetBucketLifecycleConfigurationCommand } = await loadS3Module();
    const client = await getS3Client(region);
    const response = (await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName }),
    )) as S3LifecycleResponse;

    const rules = response.Rules ?? [];
    const activeRule = rules.find((rule) => rule.Status === 'Enabled');

    if (!activeRule) {
      return {
        status: 'warning',
        message: 'No enabled lifecycle rule found for audit archive bucket',
        details: { bucket: bucketName },
      };
    }

    const transitions = activeRule.Transitions ?? [];
    const hasGlacierTransition = transitions.some(
      (transition) =>
        transition.StorageClass === 'GLACIER' ||
        transition.StorageClass === 'DEEP_ARCHIVE' ||
        transition.StorageClass === 'GLACIER_IR',
    );

    const expirationDays = activeRule.Expiration?.Days ?? null;
    const hasFiveYearRetention = expirationDays == null || expirationDays >= 365 * 5;

    if (!hasGlacierTransition || !hasFiveYearRetention) {
      return {
        status: 'warning',
        message:
          'Audit archive lifecycle must transition to Glacier and retain logs for at least 5 years',
        details: {
          bucket: bucketName,
          transitions,
          expirationDays,
        },
      };
    }

    return {
      status: 'ok',
      message: 'Audit archive lifecycle is configured',
      details: {
        bucket: bucketName,
        transitions,
        expirationDays,
      },
    };
  } catch (err) {
    logBackupMonitorError(options, '[backup-monitor] Audit archive lifecycle check failed:', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check that Cognito Advanced Security is enabled for the configured User Pool.
 */
export async function checkCognitoAdvancedSecurity(
  options: BackupMonitorOptions = {},
): Promise<BackupCheckResult> {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1';
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;

  if (!userPoolId) {
    return { status: 'skipped', message: 'Cognito user pool not configured' };
  }

  try {
    const { DescribeUserPoolCommand } = await loadCognitoModule();
    const client = await getCognitoClient(region);
    const response = await client.send(new DescribeUserPoolCommand({ UserPoolId: userPoolId }));

    const mode = response.UserPool?.UserPoolAddOns?.AdvancedSecurityMode ?? 'OFF';
    if (mode !== 'ENFORCED') {
      return {
        status: 'warning',
        message: `Cognito Advanced Security mode is ${mode}`,
        details: { userPoolId, mode },
      };
    }

    return {
      status: 'ok',
      message: 'Cognito Advanced Security is enforced',
      details: { userPoolId, mode },
    };
  } catch (err) {
    logBackupMonitorError(options, '[backup-monitor] Cognito Advanced Security check failed:', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run all backup monitoring checks.
 */
export async function runBackupMonitorChecks(options: BackupMonitorOptions = {}): Promise<{
  overall: 'ok' | 'warning' | 'error';
  checks: Record<string, BackupCheckResult>;
}> {
  const [rdsSnapshot, s3Versioning, auditArchive, cognitoAdvancedSecurity] = await Promise.all([
    checkRdsSnapshot(options),
    checkS3Versioning(options),
    checkAuditLogArchivePolicy(options),
    checkCognitoAdvancedSecurity(options),
  ]);

  const checks: Record<string, BackupCheckResult> = {
    rdsSnapshot,
    s3Versioning,
    auditArchive,
    cognitoAdvancedSecurity,
  };

  let overall: 'ok' | 'warning' | 'error' = 'ok';
  for (const result of Object.values(checks)) {
    if (result.status === 'error') {
      overall = 'error';
      break;
    }
    if (result.status === 'warning') {
      overall = 'warning';
    }
  }

  return { overall, checks };
}
