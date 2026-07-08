/**
 * Backup monitoring helpers for RDS snapshots and S3 versioning.
 * Gracefully skipped when AWS SDK credentials are not configured.
 */

import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';
import { logger as safeLogger } from '@/lib/utils/logger';

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
  strict?: boolean;
};

type BackupMonitorOperation =
  | 'aws_backup_vault_check'
  | 'aws_backup_recovery_point_check'
  | 'rds_instance_backup_configuration_check'
  | 'rds_snapshot_check'
  | 's3_versioning_check'
  | 's3_object_lock_configuration_check'
  | 'audit_archive_lifecycle_check'
  | 'cognito_advanced_security_check';

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

type RdsDbInstancesResponse = {
  DBInstances?: Array<{
    DBInstanceStatus?: string;
    Engine?: string;
    BackupRetentionPeriod?: number;
    LatestRestorableTime?: Date;
    DeletionProtection?: boolean;
    StorageEncrypted?: boolean;
    PubliclyAccessible?: boolean;
    MultiAZ?: boolean;
    CopyTagsToSnapshot?: boolean;
    PreferredBackupWindow?: string;
  }>;
};

type RdsModule = {
  RDSClient: new (
    config: AwsClientConfig,
  ) => AwsClient<RdsSnapshotsResponse | RdsDbInstancesResponse>;
  DescribeDBSnapshotsCommand: new (input: {
    DBInstanceIdentifier: string;
    SnapshotType: string;
  }) => unknown;
  DescribeDBInstancesCommand: new (input: { DBInstanceIdentifier: string }) => unknown;
};

type BackupRecoveryPointsResponse = {
  RecoveryPoints?: Array<{
    RecoveryPointArn?: string;
    CreationDate?: Date;
    Status?: string;
    ResourceType?: string;
  }>;
};

type BackupVaultResponse = {
  BackupVaultName?: string;
  VaultState?: string;
  VaultType?: string;
  Locked?: boolean;
  NumberOfRecoveryPoints?: number;
  EncryptionKeyType?: string;
  MinRetentionDays?: number;
  MaxRetentionDays?: number;
};

type BackupModule = {
  BackupClient: new (
    config: AwsClientConfig,
  ) => AwsClient<BackupRecoveryPointsResponse | BackupVaultResponse>;
  DescribeBackupVaultCommand: new (input: { BackupVaultName: string }) => unknown;
  ListRecoveryPointsByBackupVaultCommand: new (input: {
    BackupVaultName: string;
    ByResourceArn: string;
    ByResourceType: string;
    MaxResults: number;
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

type S3ObjectLockResponse = {
  ObjectLockConfiguration?: {
    ObjectLockEnabled?: string;
    Rule?: {
      DefaultRetention?: {
        Mode?: string;
        Days?: number;
        Years?: number;
      };
    };
  };
};

type S3Module = {
  S3Client: new (
    config: AwsClientConfig,
  ) => AwsClient<S3VersioningResponse | S3LifecycleResponse | S3ObjectLockResponse>;
  GetBucketVersioningCommand: new (input: { Bucket: string }) => unknown;
  GetBucketLifecycleConfigurationCommand: new (input: { Bucket: string }) => unknown;
  GetObjectLockConfigurationCommand: new (input: { Bucket: string }) => unknown;
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

let cachedRdsModule: Promise<RdsModule> | null = null;
let cachedBackupModule: Promise<BackupModule> | null = null;
let cachedS3Module: Promise<S3Module> | null = null;
let cachedCognitoModule: Promise<CognitoModule> | null = null;
const rdsClients = new Map<string, AwsClient<RdsSnapshotsResponse | RdsDbInstancesResponse>>();
const backupClients = new Map<
  string,
  AwsClient<BackupRecoveryPointsResponse | BackupVaultResponse>
>();
const s3Clients = new Map<
  string,
  AwsClient<S3VersioningResponse | S3LifecycleResponse | S3ObjectLockResponse>
>();
const cognitoClients = new Map<string, AwsClient<CognitoResponse>>();
const BACKUP_MODULE_LOAD_FAILED_MESSAGE =
  'Unable to load @aws-sdk/client-backup for AWS Backup monitoring';
const AWS_BACKUP_VAULT_CHECK_FAILED_MESSAGE = 'AWS Backup vault check failed';
const AWS_BACKUP_RECOVERY_POINT_CHECK_FAILED_MESSAGE = 'AWS Backup recovery point check failed';
const RDS_MODULE_LOAD_FAILED_MESSAGE =
  'Unable to load @aws-sdk/client-rds for RDS backup monitoring';
const RDS_INSTANCE_BACKUP_CONFIGURATION_CHECK_FAILED_MESSAGE =
  'RDS instance backup configuration check failed';
const RDS_SNAPSHOT_CHECK_FAILED_MESSAGE = 'RDS snapshot check failed';
const S3_VERSIONING_CHECK_FAILED_MESSAGE = 'S3 versioning check failed';
const S3_OBJECT_LOCK_CHECK_FAILED_MESSAGE = 'S3 Object Lock configuration check failed';
const AUDIT_ARCHIVE_CHECK_FAILED_MESSAGE = 'Audit archive lifecycle check failed';
const COGNITO_ADVANCED_SECURITY_CHECK_FAILED_MESSAGE = 'Cognito Advanced Security check failed';

class SafeBackupMonitorError extends Error {}

function getSafeBackupMonitorMessage(err: unknown, fallback: string) {
  return err instanceof SafeBackupMonitorError ? err.message : fallback;
}

function logBackupMonitorError(
  options: BackupMonitorOptions | undefined,
  message: string,
  err: unknown,
  operation: BackupMonitorOperation,
) {
  if (options?.logger?.error) {
    options.logger.error(message, err);
    return;
  }

  try {
    safeLogger.error(
      {
        event: 'backup_monitor_check_failed',
        operation,
        externalProvider: 'aws',
      },
      err,
    );
  } catch (loggerError) {
    try {
      console.error(message, err);
    } catch (consoleError) {
      void loggerError;
      void consoleError;
    }
  }
}

async function loadRdsModule() {
  if (!cachedRdsModule) {
    cachedRdsModule = import('@aws-sdk/client-rds')
      .then((module) => module as RdsModule)
      .catch(() => {
        cachedRdsModule = null;
        throw new SafeBackupMonitorError(RDS_MODULE_LOAD_FAILED_MESSAGE);
      });
  }
  return cachedRdsModule;
}

async function loadBackupModule() {
  if (!cachedBackupModule) {
    cachedBackupModule = import('@aws-sdk/client-backup')
      .then((module) => module as BackupModule)
      .catch(() => {
        cachedBackupModule = null;
        throw new SafeBackupMonitorError(BACKUP_MODULE_LOAD_FAILED_MESSAGE);
      });
  }
  return cachedBackupModule;
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
  const client = withAwsClientTimeout(new awsModule.RDSClient({ region, ...awsClientConfig() }));
  rdsClients.set(region, client);
  return client;
}

async function getBackupClient(region: string) {
  const cached = backupClients.get(region);
  if (cached) return cached;
  const awsModule = await loadBackupModule();
  const client = withAwsClientTimeout(new awsModule.BackupClient({ region, ...awsClientConfig() }));
  backupClients.set(region, client);
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

function readPositiveNumberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isStrictBackupMonitorMode(options: BackupMonitorOptions | undefined) {
  return options?.strict === true || process.env.BACKUP_MONITOR_STRICT === 'true';
}

function isObjectLockConfigurationMissingError(err: unknown) {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as {
    name?: string;
    code?: string;
    Code?: string;
  };
  return (
    candidate.name === 'ObjectLockConfigurationNotFoundError' ||
    candidate.code === 'ObjectLockConfigurationNotFoundError' ||
    candidate.Code === 'ObjectLockConfigurationNotFoundError'
  );
}

/**
 * Check that the configured AWS Backup vault exists and exposes safe metadata
 * for operator readiness. The response intentionally omits vault/KMS ARNs.
 */
export async function checkAwsBackupVault(
  options: BackupMonitorOptions = {},
): Promise<BackupCheckResult> {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1';
  const backupVaultName = process.env.AWS_BACKUP_VAULT_NAME;

  if (!backupVaultName) {
    return { status: 'skipped', message: 'AWS_BACKUP_VAULT_NAME not configured' };
  }

  try {
    const { DescribeBackupVaultCommand } = await loadBackupModule();
    const client = await getBackupClient(region);
    const response = (await client.send(
      new DescribeBackupVaultCommand({ BackupVaultName: backupVaultName }),
    )) as BackupVaultResponse;

    const details = {
      backupVaultName,
      vaultState: response.VaultState ?? null,
      vaultType: response.VaultType ?? null,
      locked: response.Locked ?? false,
      numberOfRecoveryPoints: response.NumberOfRecoveryPoints ?? null,
      encryptionKeyType: response.EncryptionKeyType ?? null,
      minRetentionDays: response.MinRetentionDays ?? null,
      maxRetentionDays: response.MaxRetentionDays ?? null,
    };

    if (response.VaultState && response.VaultState !== 'AVAILABLE') {
      return {
        status: 'warning',
        message: `AWS Backup vault state is ${response.VaultState}`,
        details,
      };
    }

    if ((response.NumberOfRecoveryPoints ?? 0) <= 0) {
      return {
        status: 'warning',
        message: 'AWS Backup vault has no recovery points',
        details,
      };
    }

    return {
      status: 'ok',
      message: 'AWS Backup vault is available',
      details,
    };
  } catch (err) {
    const message = getSafeBackupMonitorMessage(err, AWS_BACKUP_VAULT_CHECK_FAILED_MESSAGE);
    logBackupMonitorError(
      options,
      '[backup-monitor] AWS Backup vault check failed:',
      new Error(message),
      'aws_backup_vault_check',
    );
    return {
      status: 'error',
      message,
    };
  }
}

/**
 * Check that AWS Backup has a recent completed RDS recovery point in the
 * configured backup vault. This complements the native RDS automated snapshot
 * probe and verifies the AWS Backup control plane used for recovery drills.
 */
export async function checkAwsBackupRecoveryPoint(
  options: BackupMonitorOptions = {},
): Promise<BackupCheckResult> {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1';
  const backupVaultName = process.env.AWS_BACKUP_VAULT_NAME;
  const protectedResourceArn =
    process.env.AWS_BACKUP_RDS_RESOURCE_ARN ?? process.env.RDS_DB_INSTANCE_ARN;

  if (!backupVaultName) {
    return { status: 'skipped', message: 'AWS_BACKUP_VAULT_NAME not configured' };
  }

  if (!protectedResourceArn) {
    return { status: 'skipped', message: 'AWS_BACKUP_RDS_RESOURCE_ARN not configured' };
  }

  try {
    const { ListRecoveryPointsByBackupVaultCommand } = await loadBackupModule();
    const client = await getBackupClient(region);
    const response = (await client.send(
      new ListRecoveryPointsByBackupVaultCommand({
        BackupVaultName: backupVaultName,
        ByResourceArn: protectedResourceArn,
        ByResourceType: 'RDS',
        MaxResults: 25,
      }),
    )) as BackupRecoveryPointsResponse;

    const completedRecoveryPoints = (response.RecoveryPoints ?? [])
      .filter((point) => point.Status === 'COMPLETED' && point.CreationDate)
      .sort((a, b) => (b.CreationDate?.getTime() ?? 0) - (a.CreationDate?.getTime() ?? 0));

    if (completedRecoveryPoints.length === 0) {
      return {
        status: 'warning',
        message: 'No completed AWS Backup RDS recovery points found',
        details: {
          backupVaultName,
        },
      };
    }

    const latest = completedRecoveryPoints[0];
    const ageMs = Date.now() - (latest.CreationDate?.getTime() ?? 0);
    const ageHours = ageMs / (1000 * 60 * 60);
    const maxAgeHours = readPositiveNumberEnv('AWS_BACKUP_RECOVERY_POINT_MAX_AGE_HOURS', 26);

    if (ageHours > maxAgeHours) {
      return {
        status: 'warning',
        message: `Latest AWS Backup recovery point is ${Math.round(ageHours)}h old (threshold: ${maxAgeHours}h)`,
        details: {
          backupVaultName,
          createdAt: latest.CreationDate?.toISOString(),
          resourceType: latest.ResourceType ?? 'RDS',
        },
      };
    }

    return {
      status: 'ok',
      message: `Latest AWS Backup recovery point: ${Math.round(ageHours)}h ago`,
      details: {
        backupVaultName,
        createdAt: latest.CreationDate?.toISOString(),
        resourceType: latest.ResourceType ?? 'RDS',
      },
    };
  } catch (err) {
    const message = getSafeBackupMonitorMessage(
      err,
      AWS_BACKUP_RECOVERY_POINT_CHECK_FAILED_MESSAGE,
    );
    logBackupMonitorError(
      options,
      '[backup-monitor] AWS Backup recovery point check failed:',
      new Error(message),
      'aws_backup_recovery_point_check',
    );
    return {
      status: 'error',
      message,
    };
  }
}

/**
 * Check RDS instance-level backup readiness without returning DB ARNs, endpoint
 * addresses, subnet ids, security group ids, or other infrastructure secrets.
 */
export async function checkRdsInstanceBackupConfiguration(
  options: BackupMonitorOptions = {},
): Promise<BackupCheckResult> {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1';
  const dbInstanceIdentifier = process.env.RDS_DB_INSTANCE_ID;

  if (!dbInstanceIdentifier) {
    return { status: 'skipped', message: 'RDS_DB_INSTANCE_ID not configured' };
  }

  try {
    const { DescribeDBInstancesCommand } = await loadRdsModule();
    const client = await getRdsClient(region);
    const response = (await client.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceIdentifier }),
    )) as RdsDbInstancesResponse;
    const instance = response.DBInstances?.[0];

    if (!instance) {
      return { status: 'warning', message: 'RDS DB instance was not returned' };
    }

    const minRetentionDays = readPositiveNumberEnv('RDS_BACKUP_MIN_RETENTION_DAYS', 1);
    const backupRetentionDays = instance.BackupRetentionPeriod ?? 0;
    const details = {
      status: instance.DBInstanceStatus ?? null,
      engine: instance.Engine ?? null,
      backupRetentionDays,
      latestRestorableTime: instance.LatestRestorableTime?.toISOString() ?? null,
      deletionProtection: instance.DeletionProtection ?? false,
      storageEncrypted: instance.StorageEncrypted ?? false,
      publiclyAccessible: instance.PubliclyAccessible ?? null,
      multiAz: instance.MultiAZ ?? null,
      copyTagsToSnapshot: instance.CopyTagsToSnapshot ?? null,
      preferredBackupWindow: instance.PreferredBackupWindow ?? null,
    };

    const warnings: string[] = [];
    if (instance.DBInstanceStatus && instance.DBInstanceStatus !== 'available') {
      warnings.push(`status=${instance.DBInstanceStatus}`);
    }
    if (backupRetentionDays < minRetentionDays) {
      warnings.push(`backup_retention_days=${backupRetentionDays}`);
    }
    if (!instance.LatestRestorableTime) {
      warnings.push('latest_restorable_time_missing');
    }
    if (instance.StorageEncrypted !== true) {
      warnings.push('storage_not_encrypted');
    }
    if (instance.DeletionProtection !== true) {
      warnings.push('deletion_protection_disabled');
    }
    if (instance.PubliclyAccessible === true) {
      warnings.push('publicly_accessible');
    }

    if (warnings.length > 0) {
      return {
        status: 'warning',
        message: `RDS backup configuration needs review: ${warnings.join(', ')}`,
        details,
      };
    }

    return {
      status: 'ok',
      message: 'RDS backup configuration is enabled',
      details,
    };
  } catch (err) {
    const message = getSafeBackupMonitorMessage(
      err,
      RDS_INSTANCE_BACKUP_CONFIGURATION_CHECK_FAILED_MESSAGE,
    );
    logBackupMonitorError(
      options,
      '[backup-monitor] RDS instance backup configuration check failed:',
      new Error(message),
      'rds_instance_backup_configuration_check',
    );
    return {
      status: 'error',
      message,
    };
  }
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

    const response = (await client.send(
      new rdsModule.DescribeDBSnapshotsCommand({
        DBInstanceIdentifier: dbInstanceId,
        SnapshotType: 'automated',
      }),
    )) as RdsSnapshotsResponse;

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
    const message = getSafeBackupMonitorMessage(err, RDS_SNAPSHOT_CHECK_FAILED_MESSAGE);
    logBackupMonitorError(
      options,
      '[backup-monitor] RDS snapshot check failed:',
      new Error(message),
      'rds_snapshot_check',
    );
    return {
      status: 'error',
      message,
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
    const message = getSafeBackupMonitorMessage(err, S3_VERSIONING_CHECK_FAILED_MESSAGE);
    logBackupMonitorError(
      options,
      '[backup-monitor] S3 versioning check failed:',
      new Error(message),
      's3_versioning_check',
    );
    return {
      status: 'error',
      message,
    };
  }
}

/**
 * Check that S3 Object Lock is enabled for the configured PHI file bucket.
 * The result intentionally omits the bucket name and any object keys; callers
 * only need to know whether Object Lock is enabled and which default retention
 * policy, if any, applies at the bucket level.
 */
export async function checkS3ObjectLockConfiguration(
  options: BackupMonitorOptions = {},
): Promise<BackupCheckResult> {
  const bucketName = process.env.S3_OBJECT_LOCK_BUCKET_NAME ?? process.env.S3_BUCKET_NAME;
  const region =
    process.env.S3_OBJECT_LOCK_BUCKET_REGION ??
    process.env.S3_BUCKET_REGION ??
    process.env.AWS_REGION ??
    'ap-northeast-1';

  if (!bucketName) {
    return {
      status: 'skipped',
      message: 'S3_OBJECT_LOCK_BUCKET_NAME or S3_BUCKET_NAME not configured',
    };
  }

  try {
    const { GetObjectLockConfigurationCommand } = await loadS3Module();
    const client = await getS3Client(region);
    const response = (await client.send(
      new GetObjectLockConfigurationCommand({ Bucket: bucketName }),
    )) as S3ObjectLockResponse;

    const configuration = response.ObjectLockConfiguration;
    const enabled = configuration?.ObjectLockEnabled === 'Enabled';
    const defaultRetention = configuration?.Rule?.DefaultRetention;
    const retentionMode = defaultRetention?.Mode ?? null;
    const retentionDays = defaultRetention?.Days ?? null;
    const retentionYears = defaultRetention?.Years ?? null;
    const details = {
      enabled,
      defaultRetentionMode: retentionMode,
      defaultRetentionDays: retentionDays,
      defaultRetentionYears: retentionYears,
    };

    if (!enabled) {
      return {
        status: 'warning',
        message: 'S3 Object Lock is not enabled',
        details,
      };
    }

    const hasDefaultRetention = Boolean(
      retentionMode || retentionDays != null || retentionYears != null,
    );
    const hasExactlyOnePeriod =
      Number(retentionDays != null) + Number(retentionYears != null) === 1;
    if (
      hasDefaultRetention &&
      ((retentionMode !== 'GOVERNANCE' && retentionMode !== 'COMPLIANCE') || !hasExactlyOnePeriod)
    ) {
      return {
        status: 'warning',
        message: 'S3 Object Lock default retention is incomplete',
        details,
      };
    }

    return {
      status: 'ok',
      message: hasDefaultRetention
        ? 'S3 Object Lock is enabled with bucket default retention'
        : 'S3 Object Lock is enabled without bucket default retention',
      details,
    };
  } catch (err) {
    if (isObjectLockConfigurationMissingError(err)) {
      return {
        status: 'warning',
        message: 'S3 Object Lock configuration is not present',
        details: {
          enabled: false,
          defaultRetentionMode: null,
          defaultRetentionDays: null,
          defaultRetentionYears: null,
        },
      };
    }

    const message = getSafeBackupMonitorMessage(err, S3_OBJECT_LOCK_CHECK_FAILED_MESSAGE);
    logBackupMonitorError(
      options,
      '[backup-monitor] S3 Object Lock configuration check failed:',
      new Error(message),
      's3_object_lock_configuration_check',
    );
    return {
      status: 'error',
      message,
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
    const message = getSafeBackupMonitorMessage(err, AUDIT_ARCHIVE_CHECK_FAILED_MESSAGE);
    logBackupMonitorError(
      options,
      '[backup-monitor] Audit archive lifecycle check failed:',
      new Error(message),
      'audit_archive_lifecycle_check',
    );
    return {
      status: 'error',
      message,
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
    const message = getSafeBackupMonitorMessage(
      err,
      COGNITO_ADVANCED_SECURITY_CHECK_FAILED_MESSAGE,
    );
    logBackupMonitorError(
      options,
      '[backup-monitor] Cognito Advanced Security check failed:',
      new Error(message),
      'cognito_advanced_security_check',
    );
    return {
      status: 'error',
      message,
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
  const strict = isStrictBackupMonitorMode(options);
  const [
    awsBackupVault,
    awsBackupRecoveryPoint,
    rdsInstanceBackupConfiguration,
    rdsSnapshot,
    s3Versioning,
    s3ObjectLock,
    auditArchive,
    cognitoAdvancedSecurity,
  ] = await Promise.all([
    checkAwsBackupVault(options),
    checkAwsBackupRecoveryPoint(options),
    checkRdsInstanceBackupConfiguration(options),
    checkRdsSnapshot(options),
    checkS3Versioning(options),
    checkS3ObjectLockConfiguration(options),
    checkAuditLogArchivePolicy(options),
    checkCognitoAdvancedSecurity(options),
  ]);

  const rawChecks: Record<string, BackupCheckResult> = {
    awsBackupVault,
    awsBackupRecoveryPoint,
    rdsInstanceBackupConfiguration,
    rdsSnapshot,
    s3Versioning,
    s3ObjectLock,
    auditArchive,
    cognitoAdvancedSecurity,
  };
  const checks = strict ? applyStrictSkippedCheckPolicy(rawChecks) : rawChecks;

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

function applyStrictSkippedCheckPolicy(checks: Record<string, BackupCheckResult>) {
  return Object.fromEntries(
    Object.entries(checks).map(([key, result]) => {
      if (result.status !== 'skipped') return [key, result];
      return [
        key,
        {
          status: 'warning',
          message: `${result.message}; strict backup monitor mode requires this check`,
          details: { strictRequired: true },
        } satisfies BackupCheckResult,
      ];
    }),
  );
}
