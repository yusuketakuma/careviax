import { describe, expect, it, vi } from 'vitest';
import { runPatientDetailTasks, runPatientDetailTasksSettled } from './patient-detail-tasks';

describe('runPatientDetailTasks', () => {
  it('limits active task concurrency and preserves named results', async () => {
    let active = 0;
    let maxActive = 0;
    const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

    const buildTask = (value: string) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep();
      active -= 1;
      return value;
    };

    const result = await runPatientDetailTasks(
      {
        first: buildTask('first-result'),
        second: buildTask('second-result'),
        third: buildTask('third-result'),
        fourth: buildTask('fourth-result'),
      },
      2,
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result).toEqual({
      first: 'first-result',
      second: 'second-result',
      third: 'third-result',
      fourth: 'fourth-result',
    });
  });

  it('normalizes invalid concurrency to one worker', async () => {
    const executionOrder: string[] = [];

    const result = await runPatientDetailTasks(
      {
        first: async () => {
          executionOrder.push('first-start');
          await Promise.resolve();
          executionOrder.push('first-end');
          return 'first-result';
        },
        second: async () => {
          executionOrder.push('second-start');
          return 'second-result';
        },
      },
      Number.NaN,
    );

    expect(executionOrder).toEqual(['first-start', 'first-end', 'second-start']);
    expect(result).toEqual({
      first: 'first-result',
      second: 'second-result',
    });
  });

  it('keeps the default helper fail-fast on task errors', async () => {
    await expect(
      runPatientDetailTasks({
        first: async () => 'first-result',
        second: async (): Promise<string> => {
          throw new Error('source failed');
        },
      }),
    ).rejects.toThrow('source failed');
  });

  it('can collect task errors with fallbacks for timeline-style callers', async () => {
    const onTaskError = vi.fn();

    const result = await runPatientDetailTasksSettled(
      {
        first: async () => 'first-result',
        second: async (): Promise<string> => {
          throw new Error('source failed');
        },
        third: async () => 'third-result',
      },
      {
        first: 'fallback-first',
        second: 'fallback-second',
        third: 'fallback-third',
      },
      {
        concurrency: 2,
        onTaskError,
      },
    );

    expect(result.results).toEqual({
      first: 'first-result',
      second: 'fallback-second',
      third: 'third-result',
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ key: 'second' });
    expect(result.failures[0]?.error).toBeInstanceOf(Error);
    expect(onTaskError).toHaveBeenCalledWith(result.failures[0]);
  });
});
