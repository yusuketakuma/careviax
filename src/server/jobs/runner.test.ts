import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  integrationJobFindFirstMock,
  integrationJobCreateMock,
  integrationJobUpdateMock,
  membershipFindManyMock,
  dispatchNotificationEventMock,
  withOrgContextMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  integrationJobFindFirstMock: vi.fn(),
  integrationJobCreateMock: vi.fn(),
  integrationJobUpdateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    integrationJob: {
      findFirst: integrationJobFindFirstMock,
      create: integrationJobCreateMock,
      update: integrationJobUpdateMock,
    },
    membership: {
      findMany: membershipFindManyMock,
    },
  },
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/lib/db/rls', () => ({
  // Run the dispatch callback synchronously with a fake tx so the delivery path
  // is exercised without a real RLS transaction.
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock,
  },
}));

import { runJob } from './runner';

function findLoggerErrorCall(event: string) {
  return loggerErrorMock.mock.calls.find(([context]) => context?.event === event);
}

describe('runJob', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    vi.clearAllMocks();
    integrationJobFindFirstMock.mockResolvedValue(null);
    integrationJobCreateMock.mockResolvedValue({ id: 'job_1' });
    integrationJobUpdateMock.mockResolvedValue({ id: 'job_1' });
    membershipFindManyMock.mockResolvedValue([]);
    dispatchNotificationEventMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation((_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({}),
    );
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('returns the job result on first-attempt success and marks the row completed', async () => {
    const result = await runJob('test_job', async () => ({ processedCount: 3 }));

    expect(result).toEqual({ processedCount: 3 });
    expect(integrationJobUpdateMock).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: expect.objectContaining({
        status: 'completed',
        output: { processedCount: 3 },
        retry_count: 0,
      }),
    });
  });

  it('skips execution when a duplicate job is already running', async () => {
    integrationJobFindFirstMock.mockResolvedValue({ id: 'running_job' });

    const fn = vi.fn();
    const result = await runJob('test_job', fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result).toEqual({ processedCount: 0, skipped: true });
    expect(integrationJobCreateMock).not.toHaveBeenCalled();
  });

  it('skips duplicate in-process starts before the running row is visible', async () => {
    let resolveJob!: (value: { processedCount: number }) => void;
    const firstFn = vi.fn(
      () =>
        new Promise<{ processedCount: number }>((resolve) => {
          resolveJob = resolve;
        }),
    );
    const secondFn = vi.fn();

    const first = runJob('test_job', firstFn, 'org_1');
    const second = runJob('test_job', secondFn, 'org_1');

    await expect(second).resolves.toEqual({ processedCount: 0, skipped: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(firstFn).toHaveBeenCalledTimes(1);
    expect(secondFn).not.toHaveBeenCalled();
    expect(integrationJobCreateMock).toHaveBeenCalledTimes(1);

    resolveJob({ processedCount: 1 });
    await expect(first).resolves.toEqual({ processedCount: 1 });
  });

  it('does not skip execution for stale running job locks', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);

    const fn = vi.fn().mockResolvedValue({ processedCount: 1 });
    const result = await runJob('test_job', fn);

    expect(result).toEqual({ processedCount: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(integrationJobFindFirstMock).toHaveBeenCalledWith({
      where: {
        job_type: 'test_job',
        status: 'running',
        OR: [{ locked_at: null }, { locked_at: { gt: new Date('2026-06-10T04:00:00.000Z') } }],
      },
      select: { id: true },
    });
    expect(integrationJobCreateMock).toHaveBeenCalled();
  });

  it('throws the original error after exhausting retries and marks the row failed', async () => {
    const original = new Error('upstream-failure');
    const fn = vi.fn().mockRejectedValue(original);

    await expect(runJob('test_job', fn)).rejects.toBe(original);

    expect(fn).toHaveBeenCalledTimes(4);
    expect(integrationJobUpdateMock).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('stores fixed job failure diagnostics and dispatches admin notifications without raw provider details', async () => {
    const original = new Error('患者A provider token=secret db_password=value');
    const fn = vi.fn().mockRejectedValue(original);
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'admin_1', org_id: 'org_1' },
      { user_id: 'owner_1', org_id: 'org_1' },
    ]);

    await expect(runJob('test_job', fn, 'org_1')).rejects.toBe(original);

    expect(fn).toHaveBeenCalledTimes(4);
    const updatePayloads = integrationJobUpdateMock.mock.calls.map(([arg]) => arg);
    const serializedUpdates = JSON.stringify(updatePayloads);
    expect(serializedUpdates).not.toContain('token=secret');
    expect(serializedUpdates).not.toContain('db_password=value');
    expect(serializedUpdates).not.toContain('患者A');
    expect(updatePayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            retry_count: 1,
            error_log: 'Attempt 1/3 failed: Job execution failed',
          }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            error_log: 'All 3 retries exhausted. Last error: Job execution failed',
          }),
        }),
      ]),
    );

    // Delivery is routed through the shared pipeline (in-app + web-push) inside an
    // org-scoped RLS transaction, with admins as explicit recipients.
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(dispatchNotificationEventMock).toHaveBeenCalledTimes(1);
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'job_execution_failed',
        type: 'urgent',
        title: 'ジョブ実行失敗',
        message: 'ジョブ「test_job」が3回リトライ後に失敗しました: ジョブの実行に失敗しました',
        link: '/admin/jobs',
        explicitUserIds: ['admin_1', 'owner_1'],
      }),
    );
    const serializedNotifications = JSON.stringify(dispatchNotificationEventMock.mock.calls);
    expect(serializedNotifications).not.toContain('token=secret');
    expect(serializedNotifications).not.toContain('db_password=value');
    expect(serializedNotifications).not.toContain('患者A');
  });

  it('dispatches per-org when admins span multiple organizations', async () => {
    const original = new Error('upstream-failure');
    const fn = vi.fn().mockRejectedValue(original);
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'admin_1', org_id: 'org_1' },
      { user_id: 'admin_2', org_id: 'org_2' },
      { user_id: 'owner_1', org_id: 'org_1' },
    ]);

    await expect(runJob('test_job', fn)).rejects.toBe(original);

    expect(dispatchNotificationEventMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(withOrgContextMock).toHaveBeenCalledWith('org_2', expect.any(Function));
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', explicitUserIds: ['admin_1', 'owner_1'] }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_2', explicitUserIds: ['admin_2'] }),
    );
  });

  it('emits a structured job-failure log for CloudWatch on the failure path', async () => {
    const original = new Error('upstream-failure token=secret');
    const fn = vi.fn().mockRejectedValue(original);

    await expect(runJob('test_job', fn, 'org_1')).rejects.toBe(original);

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'job.execution_failed',
        jobType: 'test_job',
        operation: 'run_job',
        code: 'JOB_RETRIES_EXHAUSTED',
        orgId: 'org_1',
      }),
      original,
    );
  });

  it('continues (throws the original error) even when notification dispatch fails', async () => {
    const original = new Error('upstream-failure');
    const deliveryError = new Error('web-push transport down token=secret patient=患者A');
    const fn = vi.fn().mockRejectedValue(original);
    membershipFindManyMock.mockResolvedValue([{ user_id: 'admin_1', org_id: 'org_1' }]);
    dispatchNotificationEventMock.mockRejectedValue(deliveryError);

    await expect(runJob('test_job', fn, 'org_1')).rejects.toBe(original);

    expect(fn).toHaveBeenCalledTimes(4);
    expect(dispatchNotificationEventMock).toHaveBeenCalledTimes(1);
    expect(integrationJobUpdateMock).toHaveBeenCalledWith({
      where: { id: 'job_1' },
      data: expect.objectContaining({ status: 'failed' }),
    });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'job.failure_notification_delivery_failed',
        jobType: 'test_job',
        operation: 'notify_admins_of_job_failure',
        code: 'JOB_FAILURE_NOTIFICATION_DELIVERY_FAILED',
        orgId: 'org_1',
      }),
      deliveryError,
    );
    const deliveryLog = findLoggerErrorCall('job.failure_notification_delivery_failed');
    expect(JSON.stringify(deliveryLog?.[0])).not.toContain('token=secret');
    expect(JSON.stringify(deliveryLog?.[0])).not.toContain('患者A');
  });

  it('continues delivery for other orgs when one job-failure notification dispatch fails', async () => {
    const original = new Error('upstream-failure');
    const deliveryError = new Error('org_1 delivery failed token=secret');
    const fn = vi.fn().mockRejectedValue(original);
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'admin_1', org_id: 'org_1' },
      { user_id: 'admin_2', org_id: 'org_2' },
    ]);
    dispatchNotificationEventMock.mockRejectedValueOnce(deliveryError).mockResolvedValueOnce([]);

    await expect(runJob('test_job', fn)).rejects.toBe(original);

    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(withOrgContextMock).toHaveBeenCalledWith('org_2', expect.any(Function));
    expect(dispatchNotificationEventMock).toHaveBeenCalledTimes(2);
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_2', explicitUserIds: ['admin_2'] }),
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'job.failure_notification_delivery_failed',
        jobType: 'test_job',
        orgId: 'org_1',
      }),
      deliveryError,
    );
  });

  it('preserves the original job error when admin notification lookup fails', async () => {
    const original = new Error('upstream token=secret patient=患者A');
    const notificationError = new Error('membership lookup failed db_password=value');
    const fn = vi.fn().mockRejectedValue(original);
    membershipFindManyMock.mockRejectedValue(notificationError);

    await expect(runJob('test_job', fn, 'org_1')).rejects.toBe(original);

    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'job.failure_notification_failed',
        jobType: 'test_job',
        operation: 'notify_admins_of_job_failure',
        code: 'JOB_FAILURE_NOTIFICATION_FAILED',
        orgId: 'org_1',
      }),
      notificationError,
    );
    const notificationLog = findLoggerErrorCall('job.failure_notification_failed');
    expect(JSON.stringify(notificationLog?.[0])).not.toContain('token=secret');
    expect(JSON.stringify(notificationLog?.[0])).not.toContain('db_password=value');
    expect(JSON.stringify(notificationLog?.[0])).not.toContain('患者A');
  });

  it('preserves the ORIGINAL error when the cleanup status update itself fails', async () => {
    const original = new Error('upstream token=secret patient=患者A');
    const cleanupError = new Error('cleanup db_password=value');
    const fn = vi.fn().mockRejectedValue(original);

    integrationJobUpdateMock.mockImplementation(async ({ data }) => {
      // Allow retry-count updates to succeed; only the final 'failed' write throws.
      if (data?.status === 'failed') throw cleanupError;
      return { id: 'job_1' };
    });

    await expect(runJob('test_job', fn)).rejects.toBe(original);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'job.cleanup_status_persist_failed',
        jobType: 'test_job',
        operation: 'mark_job_failed_after_retries',
        code: 'JOB_CLEANUP_FAILED',
        entityType: 'integration_job',
        entityId: 'job_1',
        attempt: 4,
      }),
      cleanupError,
    );
    const cleanupLog = findLoggerErrorCall('job.cleanup_status_persist_failed');
    expect(JSON.stringify(cleanupLog?.[0])).not.toContain('token=secret');
    expect(JSON.stringify(cleanupLog?.[0])).not.toContain('db_password=value');
    expect(JSON.stringify(cleanupLog?.[0])).not.toContain('患者A');
  });
});
