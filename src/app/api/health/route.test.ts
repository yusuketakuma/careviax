import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRawMock, runBackupMonitorChecksMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  runBackupMonitorChecksMock: vi.fn(),
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

describe('/api/health GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok when database and backup checks are healthy', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    runBackupMonitorChecksMock.mockResolvedValue({
      overall: 'ok',
      checks: {
        rdsSnapshot: { status: 'ok', message: 'fresh' },
      },
    });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      checks: {
        database: { status: 'ok' },
        backups: { status: 'ok' },
      },
    });
  });

  it('returns degraded when backup monitoring reports a warning', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    runBackupMonitorChecksMock.mockResolvedValue({
      overall: 'warning',
      checks: {
        rdsSnapshot: { status: 'warning', message: 'stale' },
      },
    });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      checks: {
        backups: { status: 'warning' },
      },
    });
  });

  it('returns down when the database check fails', async () => {
    queryRawMock.mockRejectedValue(new Error('db down'));
    runBackupMonitorChecksMock.mockResolvedValue({
      overall: 'ok',
      checks: {},
    });

    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'down',
      checks: {
        database: { status: 'down' },
        backups: { status: 'ok' },
      },
    });
  });
});
