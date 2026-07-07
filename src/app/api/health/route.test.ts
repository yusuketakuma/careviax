import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getAuthContextMock, queryRawMock, runBackupMonitorChecksMock } = vi.hoisted(() => ({
  getAuthContextMock: vi.fn(),
  queryRawMock: vi.fn(),
  runBackupMonitorChecksMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: getAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

vi.mock('@/server/services/backup-monitor', () => ({
  runBackupMonitorChecks: runBackupMonitorChecksMock,
}));

import { GET } from './route';

function healthRequest() {
  return new NextRequest('http://localhost/api/health');
}

describe('/api/health GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthContextMock.mockResolvedValue(null);
  });

  it('keeps unauthenticated public liveness cheap', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    runBackupMonitorChecksMock.mockResolvedValue({
      overall: 'ok',
      checks: {
        rdsSnapshot: { status: 'ok', message: 'fresh', details: { snapshotId: 'snap-1' } },
      },
    });

    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: 'ok',
      checks: {},
    });
    expect(payload.checks.database).toBeUndefined();
    expect(payload.checks.backups).toBeUndefined();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(runBackupMonitorChecksMock).not.toHaveBeenCalled();
  });

  it('returns detailed checks for authenticated admins', async () => {
    getAuthContextMock.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    runBackupMonitorChecksMock.mockResolvedValue({
      overall: 'warning',
      checks: {
        rdsSnapshot: { status: 'warning', message: 'stale' },
      },
    });

    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      checks: {
        backups: { status: 'warning' },
      },
    });
    expect(runBackupMonitorChecksMock).toHaveBeenCalledOnce();
  });

  it('drops non-object backup details for authenticated admins', async () => {
    getAuthContextMock.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    runBackupMonitorChecksMock.mockResolvedValue({
      overall: 'warning',
      checks: ['unexpected'],
    });

    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      checks: {
        backups: { status: 'warning', details: {} },
      },
    });
  });

  it('sanitizes backup monitor details before returning admin health payloads', async () => {
    getAuthContextMock.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    runBackupMonitorChecksMock.mockResolvedValue({
      overall: 'warning',
      checks: {
        awsBackupVault: {
          status: 'warning',
          message: 'provider returned arn:aws:backup:ap-northeast-1:111122223333:backup-vault:x',
          details: {
            backupVaultName: 'ph-os-prod-rds-backup-vault',
            BackupVaultArn: 'arn:aws:backup:ap-northeast-1:111122223333:backup-vault:x',
            EncryptionKeyArn: 'arn:aws:kms:ap-northeast-1:111122223333:key/kms-secret',
            vaultState: 'AVAILABLE',
            nested: {
              endpoint: 'ph-os-prod.cluster-secret.ap-northeast-1.rds.amazonaws.com',
              VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-secret' }],
              rawError: 'token=secret db_password=value',
            },
          },
        },
        rdsInstanceBackupConfiguration: {
          status: 'warning',
          details: {
            status: 'available',
            DBInstanceArn: 'arn:aws:rds:ap-northeast-1:111122223333:db:ph-os-prod',
            DbiResourceId: 'db-resource-secret',
            storageEncrypted: true,
            subnets: ['subnet-secret'],
          },
        },
      },
    });

    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload.checks.backups.details.awsBackupVault.details).toMatchObject({
      backupVaultName: 'ph-os-prod-rds-backup-vault',
      vaultState: 'AVAILABLE',
    });
    expect(payload.checks.backups.details.rdsInstanceBackupConfiguration.details).toMatchObject({
      status: 'available',
      storageEncrypted: true,
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('arn:aws:');
    expect(serialized).not.toContain('111122223333');
    expect(serialized).not.toContain('cluster-secret');
    expect(serialized).not.toContain('sg-secret');
    expect(serialized).not.toContain('subnet-secret');
    expect(serialized).not.toContain('db-resource-secret');
    expect(serialized).not.toContain('kms-secret');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('db_password=value');
  });

  it('returns down for authenticated admins when the database check fails', async () => {
    getAuthContextMock.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
    queryRawMock.mockRejectedValue(new Error('db down'));
    runBackupMonitorChecksMock.mockResolvedValue({
      overall: 'ok',
      checks: {},
    });

    const response = await GET(healthRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'down',
      checks: {
        database: { status: 'down' },
      },
    });
    expect(runBackupMonitorChecksMock).not.toHaveBeenCalled();
  });

  it('keeps raw backup monitor errors out of authenticated admin responses', async () => {
    getAuthContextMock.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    runBackupMonitorChecksMock.mockRejectedValue(new Error('backup secret detail'));

    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: 'degraded',
      checks: {
        database: { status: 'ok' },
        backups: { status: 'error', message: 'backup monitor failed' },
      },
    });
    expect(JSON.stringify(payload)).not.toContain('backup secret detail');
  });
});
