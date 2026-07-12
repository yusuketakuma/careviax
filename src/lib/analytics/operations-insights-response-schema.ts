import { z } from 'zod';

const MONTH_KEY = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();
const NON_EMPTY_TEXT = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected non-empty text',
});
const PROCESS_KEYS = z.enum(['intake', 'audit', 'set', 'visit', 'report']);

const monthlyVisitBucketSchema = z
  .object({
    key: MONTH_KEY,
    label: NON_EMPTY_TEXT,
    count: NON_NEGATIVE_COUNT,
  })
  .strict();

const processDurationSchema = z
  .object({
    key: PROCESS_KEYS,
    label: NON_EMPTY_TEXT,
    averageMinutes: NON_NEGATIVE_COUNT,
    sampleCount: NON_NEGATIVE_COUNT,
  })
  .strict()
  .superRefine((process, context) => {
    if (process.sampleCount === 0 && process.averageMinutes !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['averageMinutes'],
        message: 'A process without samples must have zero averageMinutes',
      });
    }
  });

const operationsInsightsDataSchema = z
  .object({
    monthly_visits: z.array(monthlyVisitBucketSchema).max(5),
    processes: z.array(processDurationSchema).max(5),
    hints: z.array(z.string().refine((value) => value.trim().length > 0)).max(4),
  })
  .strict()
  .superRefine(({ monthly_visits, processes }, context) => {
    const monthKeys = new Set<string>();
    let previousMonthKey: string | null = null;
    for (const [index, bucket] of monthly_visits.entries()) {
      if (monthKeys.has(bucket.key)) {
        context.addIssue({
          code: 'custom',
          path: ['monthly_visits', index, 'key'],
          message: 'Duplicate monthly visit bucket',
        });
      }
      if (previousMonthKey && bucket.key <= previousMonthKey) {
        context.addIssue({
          code: 'custom',
          path: ['monthly_visits', index, 'key'],
          message: 'Monthly visit buckets must be chronological',
        });
      }
      monthKeys.add(bucket.key);
      previousMonthKey = bucket.key;
    }

    const processKeys = new Set<string>();
    for (const [index, process] of processes.entries()) {
      if (processKeys.has(process.key)) {
        context.addIssue({
          code: 'custom',
          path: ['processes', index, 'key'],
          message: 'Duplicate process duration',
        });
      }
      processKeys.add(process.key);
    }
  });

export const operationsInsightsResponseSchema = z
  .object({
    data: operationsInsightsDataSchema,
  })
  .strict();

export type MonthlyVisitBucket = z.infer<typeof monthlyVisitBucketSchema>;
export type ProcessDuration = z.infer<typeof processDurationSchema>;
export type OperationsInsights = z.infer<typeof operationsInsightsDataSchema>;
