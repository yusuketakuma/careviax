import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  careCaseFindManyMock,
  withOrgContextMock,
  runJobMock,
  syncCaseRiskCockpitOperationalTasksMock,
} = vi.hoisted(() => ({
  careCaseFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
  syncCaseRiskCockpitOperationalTasksMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('../runner', () => ({
  runJob: runJobMock,
}));

vi.mock('@/server/services/case-risk-task-sync', () => ({
  syncCaseRiskCockpitOperationalTasks: syncCaseRiskCockpitOperationalTasksMock,
}));

import {
  CASE_RISK_TASK_SYNC_SYSTEM_USER_ID,
  DAILY_CASE_RISK_TASK_SYNC_JOB_TYPE,
  resolveCaseRiskTaskSyncLimit,
  syncCaseRiskCockpitRiskTasks,
} from './case-risk-tasks';

describe('syncCaseRiskCockpitRiskTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runJobMock.mockImplementation(async (_jobType: string, fn: () => Promise<unknown>) => fn());
    withOrgContextMock.mockImplementation(
      async (orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({ orgId }),
    );
    syncCaseRiskCockpitOperationalTasksMock.mockResolvedValue({
      upserted_task_count: 1,
      resolved_stale_task_count: 2,
      taskable_finding_count: 3,
      skipped_finding_count: 4,
    });
  });

  it('scans active-ish cases with a bounded stable selector and org scope', async () => {
    careCaseFindManyMock.mockResolvedValue([
      { id: 'case_1', org_id: 'org_1' },
      { id: 'case_2', org_id: 'org_1' },
    ]);

    const result = await syncCaseRiskCockpitRiskTasks({
      orgId: 'org_1',
      now: new Date('2026-07-06T00:00:00.000Z'),
    });

    expect(runJobMock).toHaveBeenCalledWith(
      DAILY_CASE_RISK_TASK_SYNC_JOB_TYPE,
      expect.any(Function),
      'org_1',
    );
    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: {
        status: { in: ['assessment', 'active', 'on_hold'] },
        org_id: 'org_1',
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        org_id: true,
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(syncCaseRiskCockpitOperationalTasksMock).toHaveBeenCalledWith(
      { orgId: 'org_1' },
      {
        orgId: 'org_1',
        caseId: 'case_1',
        userId: CASE_RISK_TASK_SYNC_SYSTEM_USER_ID,
        role: 'admin',
        now: new Date('2026-07-06T00:00:00.000Z'),
      },
    );
    expect(result).toEqual({
      processedCount: 2,
      scannedCount: 2,
      upsertedTaskCount: 2,
      resolvedStaleTaskCount: 4,
      taskableFindingCount: 6,
      skippedFindingCount: 8,
      skippedCaseCount: 0,
      errorCount: 0,
      limited: false,
      limit: 100,
    });
    expect(JSON.stringify(result)).not.toContain('case_1');
  });

  it('runs across organizations for API-key jobs while keeping per-case RLS context', async () => {
    careCaseFindManyMock.mockResolvedValue([
      { id: 'case_a', org_id: 'org_a' },
      { id: 'case_b', org_id: 'org_b' },
    ]);

    await syncCaseRiskCockpitRiskTasks();

    expect(runJobMock).toHaveBeenCalledWith(
      DAILY_CASE_RISK_TASK_SYNC_JOB_TYPE,
      expect.any(Function),
      undefined,
    );
    expect(careCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['assessment', 'active', 'on_hold'] },
        },
      }),
    );
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_a', expect.any(Function));
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_b', expect.any(Function));
  });

  it('counts null and failed cases without returning raw ids or raw error details', async () => {
    careCaseFindManyMock.mockResolvedValue([
      { id: 'case_null', org_id: 'org_1' },
      { id: 'case_fail', org_id: 'org_1' },
    ]);
    syncCaseRiskCockpitOperationalTasksMock
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('患者 山田太郎 token=secret risk:privacy_security:raw'));

    const result = await syncCaseRiskCockpitRiskTasks({ orgId: 'org_1', limit: 2 });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      processedCount: 0,
      scannedCount: 2,
      skippedCaseCount: 1,
      errorCount: 1,
      limited: true,
      limit: 2,
    });
    expect(serialized).not.toContain('case_null');
    expect(serialized).not.toContain('case_fail');
    expect(serialized).not.toContain('山田太郎');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('risk:privacy_security');
  });

  it('normalizes unsafe limits', () => {
    expect(resolveCaseRiskTaskSyncLimit(undefined)).toBe(100);
    expect(resolveCaseRiskTaskSyncLimit(Number.NaN)).toBe(100);
    expect(resolveCaseRiskTaskSyncLimit(0)).toBe(100);
    expect(resolveCaseRiskTaskSyncLimit(7.9)).toBe(7);
    expect(resolveCaseRiskTaskSyncLimit(9999)).toBe(500);
  });
});
