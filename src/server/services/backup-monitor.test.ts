import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkAuditLogArchivePolicy,
  checkCognitoAdvancedSecurity,
  checkRdsSnapshot,
  checkS3Versioning,
  runBackupMonitorChecks,
} from './backup-monitor';

describe('backup-monitor', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RDS_DB_INSTANCE_ID;
    delete process.env.S3_BUCKET_NAME;
    delete process.env.AUDIT_LOG_ARCHIVE_BUCKET_NAME;
    delete process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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
    await expect(runBackupMonitorChecks()).resolves.toMatchObject({
      overall: 'ok',
      checks: {
        rdsSnapshot: { status: 'skipped' },
        s3Versioning: { status: 'skipped' },
        auditArchive: { status: 'skipped' },
        cognitoAdvancedSecurity: { status: 'skipped' },
      },
    });
  });
});
