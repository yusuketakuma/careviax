import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  integrationJobFindFirstMock,
  integrationJobCreateMock,
  integrationJobUpdateMock,
  membershipFindManyMock,
  notificationCreateManyMock,
} = vi.hoisted(() => ({
  integrationJobFindFirstMock: vi.fn(),
  integrationJobCreateMock: vi.fn(),
  integrationJobUpdateMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  notificationCreateManyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    integrationJob: {
      findFirst: integrationJobFindFirstMock,
      create: integrationJobCreateMock,
      update: integrationJobUpdateMock,
    },
    membership: {
      findMany: membershipFindManyMock,
    },
    notification: {
      createMany: notificationCreateManyMock,
    },
  },
}));

import { runJob } from './runner';

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
    notificationCreateManyMock.mockResolvedValue({ count: 0 });
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

  it('preserves the ORIGINAL error when the cleanup status update itself fails', async () => {
    const original = new Error('upstream-failure');
    const cleanupError = new Error('db-down-during-cleanup');
    const fn = vi.fn().mockRejectedValue(original);

    integrationJobUpdateMock.mockImplementation(async ({ data }) => {
      // Allow retry-count updates to succeed; only the final 'failed' write throws.
      if (data?.status === 'failed') throw cleanupError;
      return { id: 'job_1' };
    });

    await expect(runJob('test_job', fn)).rejects.toBe(original);

    // Verify the operator-facing log fired with both errors for triage.
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('CRITICAL'));
    expect(consoleErrorSpy.mock.calls.flat().join(' ')).toContain('db-down-during-cleanup');
    expect(consoleErrorSpy.mock.calls.flat().join(' ')).toContain('upstream-failure');
  });
});
