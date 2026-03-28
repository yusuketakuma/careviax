/**
 * Backup monitoring helpers for RDS snapshots and S3 versioning.
 * Gracefully skipped when AWS SDK credentials are not configured.
 */

export type BackupCheckResult = {
  status: 'ok' | 'warning' | 'error' | 'skipped';
  message: string;
  details?: Record<string, unknown>;
};

/**
 * Check latest RDS automated snapshot age.
 * Returns warning if the latest snapshot is older than 26 hours (allowing buffer over 24h cycle).
 */
export async function checkRdsSnapshot(): Promise<BackupCheckResult> {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1';
  const dbInstanceId = process.env.RDS_DB_INSTANCE_ID;

  if (!dbInstanceId) {
    console.log('[backup-monitor] RDS_DB_INSTANCE_ID not set — skipping snapshot check');
    return { status: 'skipped', message: 'RDS_DB_INSTANCE_ID not configured' };
  }

  try {
    // Dynamic import — @aws-sdk/client-rds may not be installed
    let rdsModule: {
      RDSClient: new (config: { region: string }) => { send: (cmd: unknown) => Promise<{ DBSnapshots?: Array<{ DBSnapshotIdentifier?: string; SnapshotCreateTime?: Date }> }> };
      DescribeDBSnapshotsCommand: new (input: { DBInstanceIdentifier: string; SnapshotType: string }) => unknown;
    };
    try {
      // @ts-expect-error — @aws-sdk/client-rds is an optional dependency
      rdsModule = await import('@aws-sdk/client-rds');
    } catch {
      console.log('[backup-monitor] @aws-sdk/client-rds not installed — skipping');
      return { status: 'skipped', message: '@aws-sdk/client-rds not installed' };
    }

    const client = new rdsModule.RDSClient({ region });
    const response = await client.send(
      new rdsModule.DescribeDBSnapshotsCommand({
        DBInstanceIdentifier: dbInstanceId,
        SnapshotType: 'automated',
      })
    );

    const snapshots = response.DBSnapshots ?? [];
    if (snapshots.length === 0) {
      return { status: 'warning', message: 'No automated snapshots found' };
    }

    // Sort by creation time descending
    const sorted = [...snapshots].sort(
      (a, b) =>
        (b.SnapshotCreateTime?.getTime() ?? 0) - (a.SnapshotCreateTime?.getTime() ?? 0)
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
    console.error('[backup-monitor] RDS snapshot check failed:', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check that S3 bucket versioning is enabled.
 */
export async function checkS3Versioning(): Promise<BackupCheckResult> {
  const bucketName = process.env.S3_BUCKET_NAME;
  const region = process.env.S3_BUCKET_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-1';

  if (!bucketName) {
    console.log('[backup-monitor] S3_BUCKET_NAME not set — skipping versioning check');
    return { status: 'skipped', message: 'S3_BUCKET_NAME not configured' };
  }

  try {
    const { S3Client, GetBucketVersioningCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region });
    const response = await client.send(
      new GetBucketVersioningCommand({ Bucket: bucketName })
    );

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
    console.error('[backup-monitor] S3 versioning check failed:', err);
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
export async function checkAuditLogArchivePolicy(): Promise<BackupCheckResult> {
  const bucketName =
    process.env.AUDIT_LOG_ARCHIVE_BUCKET_NAME ?? process.env.S3_BUCKET_NAME;
  const region =
    process.env.AUDIT_LOG_ARCHIVE_BUCKET_REGION ??
    process.env.S3_BUCKET_REGION ??
    process.env.AWS_REGION ??
    'ap-northeast-1';

  if (!bucketName) {
    console.log('[backup-monitor] AUDIT_LOG_ARCHIVE_BUCKET_NAME not set — skipping lifecycle check');
    return { status: 'skipped', message: 'Audit archive bucket not configured' };
  }

  try {
    const {
      S3Client,
      GetBucketLifecycleConfigurationCommand,
    } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region });
    const response = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName }),
    );

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
    const hasGlacierTransition = transitions.some((transition) =>
      transition.StorageClass === 'GLACIER' ||
      transition.StorageClass === 'DEEP_ARCHIVE' ||
      transition.StorageClass === 'GLACIER_IR',
    );

    const expirationDays = activeRule.Expiration?.Days ?? null;
    const hasFiveYearRetention =
      expirationDays == null || expirationDays >= 365 * 5;

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
    console.error('[backup-monitor] Audit archive lifecycle check failed:', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check that Cognito Advanced Security is enabled for the configured User Pool.
 */
export async function checkCognitoAdvancedSecurity(): Promise<BackupCheckResult> {
  const region = process.env.AWS_REGION ?? 'ap-northeast-1';
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;

  if (!userPoolId) {
    console.log('[backup-monitor] NEXT_PUBLIC_COGNITO_USER_POOL_ID not set — skipping cognito check');
    return { status: 'skipped', message: 'Cognito user pool not configured' };
  }

  try {
    const {
      CognitoIdentityProviderClient,
      DescribeUserPoolCommand,
    } = await import('@aws-sdk/client-cognito-identity-provider');
    const client = new CognitoIdentityProviderClient({ region });
    const response = await client.send(
      new DescribeUserPoolCommand({ UserPoolId: userPoolId }),
    );

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
    console.error('[backup-monitor] Cognito Advanced Security check failed:', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run all backup monitoring checks.
 */
export async function runBackupMonitorChecks(): Promise<{
  overall: 'ok' | 'warning' | 'error';
  checks: Record<string, BackupCheckResult>;
}> {
  const [rdsSnapshot, s3Versioning, auditArchive, cognitoAdvancedSecurity] = await Promise.all([
    checkRdsSnapshot(),
    checkS3Versioning(),
    checkAuditLogArchivePolicy(),
    checkCognitoAdvancedSecurity(),
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
