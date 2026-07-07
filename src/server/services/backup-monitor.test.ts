import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkAwsBackupVault,
  checkAwsBackupRecoveryPoint,
  checkAuditLogArchivePolicy,
  checkCognitoAdvancedSecurity,
  checkRdsInstanceBackupConfiguration,
  checkRdsSnapshot,
  checkS3Versioning,
  runBackupMonitorChecks,
} from './backup-monitor';

const {
  backupClientMock,
  backupSendMock,
  describeBackupVaultCommandMock,
  listRecoveryPointsByBackupVaultCommandMock,
  rdsClientMock,
  rdsSendMock,
  describeDbInstancesCommandMock,
  describeDbSnapshotsCommandMock,
  s3ClientMock,
  s3SendMock,
  getBucketVersioningCommandMock,
  cognitoClientMock,
  cognitoSendMock,
  describeUserPoolCommandMock,
} = vi.hoisted(() => ({
  backupClientMock: vi.fn(),
  backupSendMock: vi.fn(),
  describeBackupVaultCommandMock: vi.fn(),
  listRecoveryPointsByBackupVaultCommandMock: vi.fn(),
  rdsClientMock: vi.fn(),
  rdsSendMock: vi.fn(),
  describeDbInstancesCommandMock: vi.fn(),
  describeDbSnapshotsCommandMock: vi.fn(),
  s3ClientMock: vi.fn(),
  s3SendMock: vi.fn(),
  getBucketVersioningCommandMock: vi.fn(),
  cognitoClientMock: vi.fn(),
  cognitoSendMock: vi.fn(),
  describeUserPoolCommandMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-backup', () => ({
  BackupClient: class BackupClient {
    send = backupSendMock;

    constructor(config: unknown) {
      backupClientMock(config);
    }
  },
  DescribeBackupVaultCommand: class DescribeBackupVaultCommand {
    constructor(input: unknown) {
      describeBackupVaultCommandMock(input);
    }
  },
  ListRecoveryPointsByBackupVaultCommand: class ListRecoveryPointsByBackupVaultCommand {
    constructor(input: unknown) {
      listRecoveryPointsByBackupVaultCommandMock(input);
    }
  },
}));

vi.mock('@aws-sdk/client-rds', () => ({
  RDSClient: class RDSClient {
    send = rdsSendMock;

    constructor(config: unknown) {
      rdsClientMock(config);
    }
  },
  DescribeDBSnapshotsCommand: class DescribeDBSnapshotsCommand {
    constructor(input: unknown) {
      describeDbSnapshotsCommandMock(input);
    }
  },
  DescribeDBInstancesCommand: class DescribeDBInstancesCommand {
    constructor(input: unknown) {
      describeDbInstancesCommandMock(input);
    }
  },
}));

function mockRdsSdk() {
  vi.doMock('@aws-sdk/client-rds', () => ({
    RDSClient: class RDSClient {
      send = rdsSendMock;

      constructor(config: unknown) {
        rdsClientMock(config);
      }
    },
    DescribeDBSnapshotsCommand: class DescribeDBSnapshotsCommand {
      constructor(input: unknown) {
        describeDbSnapshotsCommandMock(input);
      }
    },
    DescribeDBInstancesCommand: class DescribeDBInstancesCommand {
      constructor(input: unknown) {
        describeDbInstancesCommandMock(input);
      }
    },
  }));
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {
    send = s3SendMock;

    constructor(config: unknown) {
      s3ClientMock(config);
    }
  },
  GetBucketVersioningCommand: class GetBucketVersioningCommand {
    constructor(input: unknown) {
      getBucketVersioningCommandMock(input);
    }
  },
  GetBucketLifecycleConfigurationCommand: class GetBucketLifecycleConfigurationCommand {
    constructor() {}
  },
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class CognitoIdentityProviderClient {
    send = cognitoSendMock;

    constructor(config: unknown) {
      cognitoClientMock(config);
    }
  },
  DescribeUserPoolCommand: class DescribeUserPoolCommand {
    constructor(input: unknown) {
      describeUserPoolCommandMock(input);
    }
  },
}));

describe('backup-monitor', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.RDS_DB_INSTANCE_ID;
    delete process.env.RDS_DB_INSTANCE_ARN;
    delete process.env.RDS_BACKUP_MIN_RETENTION_DAYS;
    delete process.env.AWS_BACKUP_VAULT_NAME;
    delete process.env.AWS_BACKUP_RDS_RESOURCE_ARN;
    delete process.env.AWS_BACKUP_RECOVERY_POINT_MAX_AGE_HOURS;
    delete process.env.S3_BUCKET_NAME;
    delete process.env.AUDIT_LOG_ARCHIVE_BUCKET_NAME;
    delete process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    delete process.env.AWS_REGION;
    delete process.env.S3_BUCKET_REGION;
    backupSendMock.mockResolvedValue({
      BackupVaultName: 'ph-os-prod-rds-backup-vault',
      VaultState: 'AVAILABLE',
      VaultType: 'BACKUP_VAULT',
      Locked: false,
      NumberOfRecoveryPoints: 1,
      EncryptionKeyType: 'CUSTOMER_MANAGED_KMS_KEY',
      RecoveryPoints: [
        {
          RecoveryPointArn: 'arn:aws:backup:ap-northeast-1:111122223333:recovery-point:rp-1',
          CreationDate: new Date(),
          Status: 'COMPLETED',
          ResourceType: 'RDS',
        },
      ],
    });
    rdsSendMock.mockResolvedValue({
      DBInstances: [
        {
          DBInstanceStatus: 'available',
          Engine: 'postgres',
          BackupRetentionPeriod: 7,
          LatestRestorableTime: new Date(),
          DeletionProtection: true,
          StorageEncrypted: true,
          PubliclyAccessible: false,
          MultiAZ: true,
          CopyTagsToSnapshot: true,
          PreferredBackupWindow: '17:00-17:30',
        },
      ],
      DBSnapshots: [
        {
          DBSnapshotIdentifier: 'snapshot_1',
          SnapshotCreateTime: new Date(),
        },
      ],
    });
    s3SendMock.mockResolvedValue({ Status: 'Enabled' });
    cognitoSendMock.mockResolvedValue({
      UserPool: {
        UserPoolAddOns: {
          AdvancedSecurityMode: 'ENFORCED',
        },
      },
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('skips the AWS Backup vault check until the vault is configured', async () => {
    await expect(checkAwsBackupVault()).resolves.toMatchObject({
      status: 'skipped',
      message: 'AWS_BACKUP_VAULT_NAME not configured',
    });
  });

  it('checks AWS Backup vault metadata without exposing vault or KMS ARNs', async () => {
    process.env.AWS_BACKUP_VAULT_NAME = 'ph-os-prod-rds-backup-vault';
    backupSendMock.mockResolvedValueOnce({
      BackupVaultName: 'ph-os-prod-rds-backup-vault',
      BackupVaultArn: 'arn:aws:backup:ap-northeast-1:111122223333:backup-vault:ph-os-prod',
      VaultState: 'AVAILABLE',
      VaultType: 'BACKUP_VAULT',
      Locked: true,
      NumberOfRecoveryPoints: 3,
      EncryptionKeyType: 'CUSTOMER_MANAGED_KMS_KEY',
      EncryptionKeyArn: 'arn:aws:kms:ap-northeast-1:111122223333:key/kms-secret',
      MinRetentionDays: 7,
      MaxRetentionDays: 35,
    });

    const result = await checkAwsBackupVault();

    expect(result).toMatchObject({
      status: 'ok',
      details: {
        backupVaultName: 'ph-os-prod-rds-backup-vault',
        vaultState: 'AVAILABLE',
        locked: true,
        numberOfRecoveryPoints: 3,
        encryptionKeyType: 'CUSTOMER_MANAGED_KMS_KEY',
      },
    });
    expect(describeBackupVaultCommandMock).toHaveBeenCalledWith({
      BackupVaultName: 'ph-os-prod-rds-backup-vault',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('111122223333');
    expect(serialized).not.toContain('backup-vault:');
    expect(serialized).not.toContain('key/kms-secret');
  });

  it('warns when AWS Backup vault metadata indicates an unavailable or empty vault', async () => {
    process.env.AWS_BACKUP_VAULT_NAME = 'ph-os-prod-rds-backup-vault';
    backupSendMock.mockResolvedValueOnce({
      VaultState: 'CREATE_FAILED',
      NumberOfRecoveryPoints: 5,
    });

    await expect(checkAwsBackupVault()).resolves.toMatchObject({
      status: 'warning',
      message: 'AWS Backup vault state is CREATE_FAILED',
    });

    backupSendMock.mockResolvedValueOnce({
      VaultState: 'AVAILABLE',
      NumberOfRecoveryPoints: 0,
    });

    await expect(checkAwsBackupVault()).resolves.toMatchObject({
      status: 'warning',
      message: 'AWS Backup vault has no recovery points',
    });
  });

  it('skips the AWS Backup recovery point check until vault and RDS resource ARN are configured', async () => {
    await expect(checkAwsBackupRecoveryPoint()).resolves.toMatchObject({
      status: 'skipped',
      message: 'AWS_BACKUP_VAULT_NAME not configured',
    });

    process.env.AWS_BACKUP_VAULT_NAME = 'ph-os-prod-rds-backup-vault';
    await expect(checkAwsBackupRecoveryPoint()).resolves.toMatchObject({
      status: 'skipped',
      message: 'AWS_BACKUP_RDS_RESOURCE_ARN not configured',
    });
  });

  it('checks recent AWS Backup RDS recovery points without exposing protected resource ARNs', async () => {
    process.env.AWS_BACKUP_VAULT_NAME = 'ph-os-prod-rds-backup-vault';
    process.env.AWS_BACKUP_RDS_RESOURCE_ARN =
      'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod';
    backupSendMock.mockResolvedValueOnce({
      RecoveryPoints: [
        {
          RecoveryPointArn: 'arn:aws:backup:ap-northeast-1:111122223333:recovery-point:old',
          CreationDate: new Date(Date.now() - 4 * 60 * 60 * 1000),
          Status: 'EXPIRED',
          ResourceType: 'RDS',
        },
        {
          RecoveryPointArn: 'arn:aws:backup:ap-northeast-1:111122223333:recovery-point:fresh',
          CreationDate: new Date(Date.now() - 60 * 60 * 1000),
          Status: 'COMPLETED',
          ResourceType: 'RDS',
        },
      ],
    });

    const result = await checkAwsBackupRecoveryPoint();

    expect(result).toMatchObject({
      status: 'ok',
      details: {
        backupVaultName: 'ph-os-prod-rds-backup-vault',
        resourceType: 'RDS',
      },
    });
    expect(listRecoveryPointsByBackupVaultCommandMock).toHaveBeenCalledWith({
      BackupVaultName: 'ph-os-prod-rds-backup-vault',
      ByResourceArn: 'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod',
      ByResourceType: 'RDS',
      MaxResults: 25,
    });
    expect(JSON.stringify(result)).not.toContain('ph-os-prod:db');
    expect(JSON.stringify(result)).not.toContain('111122223333:db:ph-os-prod');
    expect(JSON.stringify(result)).not.toContain('recovery-point:fresh');
  });

  it('warns when AWS Backup RDS recovery points are missing or stale', async () => {
    process.env.AWS_BACKUP_VAULT_NAME = 'ph-os-prod-rds-backup-vault';
    process.env.RDS_DB_INSTANCE_ARN = 'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod';

    backupSendMock.mockResolvedValueOnce({ RecoveryPoints: [] });
    await expect(checkAwsBackupRecoveryPoint()).resolves.toMatchObject({
      status: 'warning',
      message: 'No completed AWS Backup RDS recovery points found',
    });

    process.env.AWS_BACKUP_RECOVERY_POINT_MAX_AGE_HOURS = '1';
    backupSendMock.mockResolvedValueOnce({
      RecoveryPoints: [
        {
          RecoveryPointArn: 'arn:aws:backup:ap-northeast-1:111122223333:recovery-point:stale',
          CreationDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
          Status: 'COMPLETED',
          ResourceType: 'RDS',
        },
      ],
    });
    await expect(checkAwsBackupRecoveryPoint()).resolves.toMatchObject({
      status: 'warning',
      message: expect.stringContaining('Latest AWS Backup recovery point is'),
    });
  });

  it('skips the RDS instance backup configuration check until DB instance id is configured', async () => {
    await expect(checkRdsInstanceBackupConfiguration()).resolves.toMatchObject({
      status: 'skipped',
      message: 'RDS_DB_INSTANCE_ID not configured',
    });

    process.env.RDS_DB_INSTANCE_ARN = 'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod';
    await expect(checkRdsInstanceBackupConfiguration()).resolves.toMatchObject({
      status: 'skipped',
      message: 'RDS_DB_INSTANCE_ID not configured',
    });
  });

  it('checks RDS instance backup configuration without exposing endpoint or ARN fields', async () => {
    process.env.RDS_DB_INSTANCE_ID = 'ph-os-prod';
    rdsSendMock.mockResolvedValueOnce({
      DBInstances: [
        {
          DBInstanceArn: 'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod',
          DBInstanceStatus: 'available',
          DbiResourceId: 'db-resource-secret',
          Engine: 'postgres',
          Endpoint: {
            Address: 'ph-os-prod.cluster-secret.ap-northeast-1.rds.amazonaws.com',
          },
          BackupRetentionPeriod: 7,
          LatestRestorableTime: new Date(),
          DeletionProtection: true,
          StorageEncrypted: true,
          KmsKeyId: 'arn:aws:kms:ap-northeast-1:111122223333:key/kms-secret',
          PubliclyAccessible: false,
          MultiAZ: true,
          CopyTagsToSnapshot: true,
          PreferredBackupWindow: '17:00-17:30',
          VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-secret' }],
          DBSubnetGroup: { DBSubnetGroupName: 'subnet-secret' },
        },
      ],
    });

    const result = await checkRdsInstanceBackupConfiguration();

    expect(result).toMatchObject({
      status: 'ok',
      details: {
        status: 'available',
        engine: 'postgres',
        backupRetentionDays: 7,
        deletionProtection: true,
        storageEncrypted: true,
        publiclyAccessible: false,
        multiAz: true,
        copyTagsToSnapshot: true,
      },
    });
    expect(describeDbInstancesCommandMock).toHaveBeenCalledWith({
      DBInstanceIdentifier: 'ph-os-prod',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('111122223333');
    expect(serialized).not.toContain('cluster-secret');
    expect(serialized).not.toContain('db-resource-secret');
    expect(serialized).not.toContain('kms-secret');
    expect(serialized).not.toContain('sg-secret');
    expect(serialized).not.toContain('subnet-secret');
  });

  it('warns when RDS backup settings are unsafe or below the required retention floor', async () => {
    process.env.RDS_DB_INSTANCE_ID = 'ph-os-prod';
    process.env.RDS_BACKUP_MIN_RETENTION_DAYS = '7';
    rdsSendMock.mockResolvedValueOnce({
      DBInstances: [
        {
          DBInstanceStatus: 'modifying',
          Engine: 'postgres',
          BackupRetentionPeriod: 0,
          DeletionProtection: false,
          StorageEncrypted: false,
          PubliclyAccessible: true,
        },
      ],
    });

    await expect(checkRdsInstanceBackupConfiguration()).resolves.toMatchObject({
      status: 'warning',
      message: expect.stringContaining('backup_retention_days=0'),
      details: {
        status: 'modifying',
        backupRetentionDays: 0,
        latestRestorableTime: null,
        deletionProtection: false,
        storageEncrypted: false,
        publiclyAccessible: true,
      },
    });
  });

  it('skips the RDS snapshot check when the DB instance is not configured', async () => {
    await expect(checkRdsSnapshot()).resolves.toMatchObject({
      status: 'skipped',
      message: 'RDS_DB_INSTANCE_ID not configured',
    });
  });

  it('returns an error when configured RDS monitoring cannot load the AWS SDK', async () => {
    process.env.RDS_DB_INSTANCE_ID = 'ph-os-prod';
    const importError = new Error('rds sdk load failed token=secret');
    const logger = { error: vi.fn() };

    vi.resetModules();
    vi.doMock('@aws-sdk/client-rds', () => {
      throw importError;
    });

    const {
      checkRdsSnapshot: freshCheckRdsSnapshot,
      runBackupMonitorChecks: freshRunBackupMonitorChecks,
    } = await import('./backup-monitor');

    await expect(freshCheckRdsSnapshot({ logger })).resolves.toMatchObject({
      status: 'error',
      message: 'Unable to load @aws-sdk/client-rds for RDS backup monitoring',
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[backup-monitor] RDS snapshot check failed:',
      expect.any(Error),
    );
    const loggedError = logger.error.mock.calls[0]?.[1];
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).toBe(
      'Unable to load @aws-sdk/client-rds for RDS backup monitoring',
    );
    expect(String(loggedError)).not.toContain('token=secret');
    expect(loggedError).not.toBe(importError);

    logger.error.mockClear();
    await expect(freshRunBackupMonitorChecks({ logger })).resolves.toMatchObject({
      overall: 'error',
      checks: {
        rdsSnapshot: {
          status: 'error',
          message: 'Unable to load @aws-sdk/client-rds for RDS backup monitoring',
        },
      },
    });

    mockRdsSdk();
    vi.resetModules();
  });

  it('returns safe fixed messages when AWS backup checks fail', async () => {
    process.env.RDS_DB_INSTANCE_ID = 'ph-os-prod';
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    process.env.AUDIT_LOG_ARCHIVE_BUCKET_NAME = 'ph-os-audit';
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'pool_1';
    const logger = { error: vi.fn() };
    const rawFailure = new Error('aws provider failed token=secret db_password=value');

    process.env.AWS_BACKUP_VAULT_NAME = 'ph-os-prod-rds-backup-vault';
    process.env.AWS_BACKUP_RDS_RESOURCE_ARN =
      'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod';

    backupSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkAwsBackupVault({ logger })).resolves.toMatchObject({
      status: 'error',
      message: 'AWS Backup vault check failed',
    });

    backupSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkAwsBackupRecoveryPoint({ logger })).resolves.toMatchObject({
      status: 'error',
      message: 'AWS Backup recovery point check failed',
    });

    rdsSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkRdsInstanceBackupConfiguration({ logger })).resolves.toMatchObject({
      status: 'error',
      message: 'RDS instance backup configuration check failed',
    });

    rdsSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkRdsSnapshot({ logger })).resolves.toMatchObject({
      status: 'error',
      message: 'RDS snapshot check failed',
    });

    s3SendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkS3Versioning({ logger })).resolves.toMatchObject({
      status: 'error',
      message: 'S3 versioning check failed',
    });

    s3SendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkAuditLogArchivePolicy({ logger })).resolves.toMatchObject({
      status: 'error',
      message: 'Audit archive lifecycle check failed',
    });

    cognitoSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkCognitoAdvancedSecurity({ logger })).resolves.toMatchObject({
      status: 'error',
      message: 'Cognito Advanced Security check failed',
    });

    expect(logger.error).toHaveBeenCalledTimes(7);
    for (const [, loggedError] of logger.error.mock.calls) {
      expect(loggedError).toBeInstanceOf(Error);
      expect(String(loggedError)).not.toContain('token=secret');
      expect(String(loggedError)).not.toContain('db_password=value');
      expect(loggedError).not.toBe(rawFailure);
    }
  });

  it('logs default backup check failures through the safe logger without raw provider details', async () => {
    process.env.RDS_DB_INSTANCE_ID = 'ph-os-prod';
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    process.env.AUDIT_LOG_ARCHIVE_BUCKET_NAME = 'ph-os-audit';
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'pool_1';
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rawFailure = new Error(
      'aws provider failed token=secret db_password=value bucket=ph-os-files snapshot=snapshot_1 pool=pool_1',
    );

    process.env.AWS_BACKUP_VAULT_NAME = 'ph-os-prod-rds-backup-vault';
    process.env.AWS_BACKUP_RDS_RESOURCE_ARN =
      'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod';

    backupSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkAwsBackupVault()).resolves.toMatchObject({
      status: 'error',
      message: 'AWS Backup vault check failed',
    });

    backupSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkAwsBackupRecoveryPoint()).resolves.toMatchObject({
      status: 'error',
      message: 'AWS Backup recovery point check failed',
    });

    rdsSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkRdsInstanceBackupConfiguration()).resolves.toMatchObject({
      status: 'error',
      message: 'RDS instance backup configuration check failed',
    });

    rdsSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkRdsSnapshot()).resolves.toMatchObject({
      status: 'error',
      message: 'RDS snapshot check failed',
    });

    s3SendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkS3Versioning()).resolves.toMatchObject({
      status: 'error',
      message: 'S3 versioning check failed',
    });

    s3SendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkAuditLogArchivePolicy()).resolves.toMatchObject({
      status: 'error',
      message: 'Audit archive lifecycle check failed',
    });

    cognitoSendMock.mockRejectedValueOnce(rawFailure);
    await expect(checkCognitoAdvancedSecurity()).resolves.toMatchObject({
      status: 'error',
      message: 'Cognito Advanced Security check failed',
    });

    expect(consoleErrorMock).toHaveBeenCalledTimes(7);
    const entries = consoleErrorMock.mock.calls.map(([line]) => {
      return JSON.parse(String(line)) as Record<string, unknown>;
    });
    expect(entries.map((entry) => entry.operation)).toEqual([
      'aws_backup_vault_check',
      'aws_backup_recovery_point_check',
      'rds_instance_backup_configuration_check',
      'rds_snapshot_check',
      's3_versioning_check',
      'audit_archive_lifecycle_check',
      'cognito_advanced_security_check',
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        level: 'error',
        message: 'backup_monitor_check_failed',
        event: 'backup_monitor_check_failed',
        externalProvider: 'aws',
        error_name: 'Error',
      });
      expect(entry).not.toHaveProperty('stack');
      expect(entry).not.toHaveProperty('error_message');
    }
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain('token=secret');
    expect(logged).not.toContain('db_password=value');
    expect(logged).not.toContain('ph-os-prod');
    expect(logged).not.toContain('ph-os-prod-rds-backup-vault');
    expect(logged).not.toContain('111122223333');
    expect(logged).not.toContain('ph-os-files');
    expect(logged).not.toContain('ph-os-audit');
    expect(logged).not.toContain('snapshot_1');
    expect(logged).not.toContain('pool_1');
  });

  it('keeps backup checks fail-soft when the default logging sink throws', async () => {
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console sink failed token=secret');
    });

    s3SendMock.mockRejectedValueOnce(new Error('aws provider failed token=secret'));
    await expect(checkS3Versioning()).resolves.toMatchObject({
      status: 'error',
      message: 'S3 versioning check failed',
    });

    expect(consoleErrorMock).toHaveBeenCalledTimes(2);
  });

  it('skips the S3 versioning check when the bucket is not configured', async () => {
    await expect(checkS3Versioning()).resolves.toMatchObject({
      status: 'skipped',
      message: 'S3_BUCKET_NAME not configured',
    });
  });

  it('skips the audit log archive check when the archive bucket is not configured', async () => {
    await expect(checkAuditLogArchivePolicy()).resolves.toMatchObject({
      status: 'skipped',
      message: 'Audit archive bucket not configured',
    });
  });

  it('skips the Cognito advanced security check when the user pool is not configured', async () => {
    await expect(checkCognitoAdvancedSecurity()).resolves.toMatchObject({
      status: 'skipped',
      message: 'Cognito user pool not configured',
    });
  });

  it('treats all-skipped checks as overall ok for local environments', async () => {
    const consoleLogMock = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(runBackupMonitorChecks()).resolves.toMatchObject({
      overall: 'ok',
      checks: {
        awsBackupVault: { status: 'skipped' },
        rdsSnapshot: { status: 'skipped' },
        awsBackupRecoveryPoint: { status: 'skipped' },
        rdsInstanceBackupConfiguration: { status: 'skipped' },
        s3Versioning: { status: 'skipped' },
        auditArchive: { status: 'skipped' },
        cognitoAdvancedSecurity: { status: 'skipped' },
      },
    });
    expect(consoleLogMock).not.toHaveBeenCalled();
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it('uses separate regional AWS clients for backup probes when AWS_REGION changes', async () => {
    process.env.RDS_DB_INSTANCE_ID = 'ph-os-prod';
    process.env.AWS_BACKUP_VAULT_NAME = 'ph-os-prod-rds-backup-vault';
    process.env.AWS_BACKUP_RDS_RESOURCE_ARN =
      'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod';
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'pool_1';

    process.env.AWS_REGION = 'eu-central-1';
    await expect(checkAwsBackupRecoveryPoint()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkRdsSnapshot()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkS3Versioning()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkCognitoAdvancedSecurity()).resolves.toMatchObject({ status: 'ok' });

    process.env.AWS_REGION = 'ca-central-1';
    await expect(checkAwsBackupRecoveryPoint()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkRdsSnapshot()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkS3Versioning()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkCognitoAdvancedSecurity()).resolves.toMatchObject({ status: 'ok' });

    expect(backupClientMock).toHaveBeenCalledTimes(2);
    expect(backupClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(backupClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(rdsClientMock).toHaveBeenCalledTimes(2);
    expect(rdsClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(rdsClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(s3ClientMock).toHaveBeenCalledTimes(2);
    expect(s3ClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(s3ClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(cognitoClientMock).toHaveBeenCalledTimes(2);
    expect(cognitoClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        region: 'eu-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(cognitoClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        region: 'ca-central-1',
        maxAttempts: 2,
        requestHandler: expect.anything(),
      }),
    );
    expect(backupSendMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(rdsSendMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(getBucketVersioningCommandMock).toHaveBeenCalledWith({ Bucket: 'ph-os-files' });
    expect(describeUserPoolCommandMock).toHaveBeenCalledWith({ UserPoolId: 'pool_1' });
  });
});
