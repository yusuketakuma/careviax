import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkAuditLogArchivePolicy,
  checkCognitoAdvancedSecurity,
  checkRdsSnapshot,
  checkS3Versioning,
  runBackupMonitorChecks,
} from './backup-monitor';

const {
  rdsClientMock,
  rdsSendMock,
  describeDbSnapshotsCommandMock,
  s3ClientMock,
  s3SendMock,
  getBucketVersioningCommandMock,
  cognitoClientMock,
  cognitoSendMock,
  describeUserPoolCommandMock,
} = vi.hoisted(() => ({
  rdsClientMock: vi.fn(),
  rdsSendMock: vi.fn(),
  describeDbSnapshotsCommandMock: vi.fn(),
  s3ClientMock: vi.fn(),
  s3SendMock: vi.fn(),
  getBucketVersioningCommandMock: vi.fn(),
  cognitoClientMock: vi.fn(),
  cognitoSendMock: vi.fn(),
  describeUserPoolCommandMock: vi.fn(),
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
}));

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
    delete process.env.S3_BUCKET_NAME;
    delete process.env.AUDIT_LOG_ARCHIVE_BUCKET_NAME;
    delete process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
    delete process.env.AWS_REGION;
    delete process.env.S3_BUCKET_REGION;
    rdsSendMock.mockResolvedValue({
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

  it('skips the RDS snapshot check when the DB instance is not configured', async () => {
    await expect(checkRdsSnapshot()).resolves.toMatchObject({
      status: 'skipped',
      message: 'RDS_DB_INSTANCE_ID not configured',
    });
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
        rdsSnapshot: { status: 'skipped' },
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
    process.env.S3_BUCKET_NAME = 'ph-os-files';
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID = 'pool_1';

    process.env.AWS_REGION = 'eu-central-1';
    await expect(checkRdsSnapshot()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkS3Versioning()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkCognitoAdvancedSecurity()).resolves.toMatchObject({ status: 'ok' });

    process.env.AWS_REGION = 'ca-central-1';
    await expect(checkRdsSnapshot()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkS3Versioning()).resolves.toMatchObject({ status: 'ok' });
    await expect(checkCognitoAdvancedSecurity()).resolves.toMatchObject({ status: 'ok' });

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
    expect(rdsSendMock).toHaveBeenNthCalledWith(1, expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(getBucketVersioningCommandMock).toHaveBeenCalledWith({ Bucket: 'ph-os-files' });
    expect(describeUserPoolCommandMock).toHaveBeenCalledWith({ UserPoolId: 'pool_1' });
  });
});
