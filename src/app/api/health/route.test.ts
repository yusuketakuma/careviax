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

  it('keeps backup monitor errors private to authenticated admins', async () => {
    getAuthContextMock.mockResolvedValue({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'admin',
    });
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    runBackupMonitorChecksMock.mockRejectedValue(new Error('backup secret detail'));

    const response = await GET(healthRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      checks: {
        database: { status: 'ok' },
        backups: { status: 'error', message: 'backup secret detail' },
      },
    });
  });
});
