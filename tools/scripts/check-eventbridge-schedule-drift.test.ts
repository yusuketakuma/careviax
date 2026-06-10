import { beforeAll, describe, expect, it } from 'vitest';

type Drift =
  | { type: 'missing' | 'extra'; scheduleName: string }
  | {
      type: 'mismatch';
      scheduleName: string;
      field: string;
      expected: unknown;
      actual: unknown;
    };

type ScheduleDriftModule = {
  compareSchedules(
    expectedSchedules: Array<Record<string, unknown>>,
    actualSchedules: Array<Record<string, unknown>>,
    options?: { compareTarget?: boolean },
  ): Drift[];
  runScheduleDriftCheck(
    rawExpected: unknown,
    rawActual: unknown,
    options?: { compareTarget?: boolean },
  ): Drift[];
};

let scheduleDrift: ScheduleDriftModule;

beforeAll(async () => {
  // @ts-expect-error The CLI script is plain ESM and intentionally has no .d.ts file.
  scheduleDrift = (await import('./check-eventbridge-schedule-drift.mjs')) as ScheduleDriftModule;
});

const expected = {
  region: 'ap-northeast-1',
  schedules: [
    {
      name: 'ph-os-daily',
      state: 'ENABLED',
      scheduleExpression: 'cron(0 21 * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      target: {
        method: 'POST',
        url: '${APP_URL}/api/jobs/daily',
      },
      retryPolicy: {
        maximumRetryAttempts: 2,
        maximumEventAgeInSeconds: 3600,
      },
    },
    {
      name: 'ph-os-hourly',
      state: 'ENABLED',
      scheduleExpression: 'cron(0 * * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      target: {
        method: 'POST',
        url: '${APP_URL}/api/jobs/hourly',
      },
      retryPolicy: {
        maximumRetryAttempts: 1,
        maximumEventAgeInSeconds: 1800,
      },
    },
  ],
};

describe('check-eventbridge-schedule-drift', () => {
  it('reports missing, extra, and mismatched schedules from normalized exports', () => {
    const actual = {
      schedules: [
        {
          name: 'ph-os-daily',
          state: 'DISABLED',
          scheduleExpression: 'cron(5 21 * * ? *)',
          scheduleExpressionTimezone: 'UTC',
          target: {
            method: 'POST',
            url: '${APP_URL}/api/jobs/daily',
          },
          retryPolicy: {
            maximumRetryAttempts: 2,
            maximumEventAgeInSeconds: 3600,
          },
        },
        {
          name: 'ph-os-extra',
          state: 'ENABLED',
          scheduleExpression: 'cron(0 0 * * ? *)',
        },
      ],
    };

    expect(scheduleDrift.runScheduleDriftCheck(expected, actual)).toEqual([
      {
        type: 'mismatch',
        scheduleName: 'ph-os-daily',
        field: 'state',
        expected: 'ENABLED',
        actual: 'DISABLED',
      },
      {
        type: 'mismatch',
        scheduleName: 'ph-os-daily',
        field: 'scheduleExpression',
        expected: 'cron(0 21 * * ? *)',
        actual: 'cron(5 21 * * ? *)',
      },
      { type: 'extra', scheduleName: 'ph-os-extra' },
      { type: 'missing', scheduleName: 'ph-os-hourly' },
    ]);
  });

  it('normalizes AWS Scheduler get-schedule output', () => {
    const actual = [
      {
        Name: 'ph-os-daily',
        State: 'ENABLED',
        ScheduleExpression: 'cron(0 21 * * ? *)',
        ScheduleExpressionTimezone: 'UTC',
        Target: {
          RetryPolicy: {
            MaximumRetryAttempts: 2,
            MaximumEventAgeInSeconds: 3600,
          },
        },
      },
      {
        Name: 'ph-os-hourly',
        State: 'ENABLED',
        ScheduleExpression: 'cron(0 * * * ? *)',
        ScheduleExpressionTimezone: 'UTC',
        Target: {
          RetryPolicy: {
            MaximumRetryAttempts: 1,
            MaximumEventAgeInSeconds: 1800,
          },
        },
      },
    ];

    expect(scheduleDrift.runScheduleDriftCheck(expected, actual, { compareTarget: false })).toEqual(
      [],
    );
  });

  it('compares already-normalized schedule records', () => {
    expect(
      scheduleDrift.compareSchedules(
        [{ name: 'ph-os-daily', state: 'ENABLED', scheduleExpression: 'cron(0 21 * * ? *)' }],
        [{ name: 'ph-os-daily', state: 'ENABLED', scheduleExpression: 'cron(0 21 * * ? *)' }],
      ),
    ).toEqual([]);
  });
});
