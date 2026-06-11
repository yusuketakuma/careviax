import { describe, expect, it } from 'vitest';
import { runPatientDetailTasks } from './patient-detail-tasks';

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
});
