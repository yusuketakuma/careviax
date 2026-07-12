import { z } from 'zod';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;
const STAFF_ROLES = z.enum(['owner', 'admin', 'pharmacist', 'pharmacist_trainee']);
const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();
const NON_NEGATIVE_NUMBER = z.number().finite().nonnegative();
const PERCENTAGE = z.number().finite().min(0).max(100);
const NON_EMPTY_TEXT = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected non-empty text',
});

const staffMetricItemSchema = z
  .object({
    id: NON_EMPTY_TEXT,
    name: NON_EMPTY_TEXT,
    role: STAFF_ROLES,
    site_name: NON_EMPTY_TEXT.nullable(),
    monthly_visit_count: NON_NEGATIVE_COUNT,
    assigned_patient_count: NON_NEGATIVE_COUNT,
    avg_visit_minutes: NON_NEGATIVE_NUMBER.nullable(),
    report_submission_rate: PERCENTAGE,
    shift_days: NON_NEGATIVE_COUNT,
    shift_hours: NON_NEGATIVE_NUMBER,
    workload_balance_delta_percent: z.number().finite(),
    workload_utilization_percent: NON_NEGATIVE_NUMBER.nullable(),
  })
  .strip();

const staffMetricsSummarySchema = z
  .object({
    total_staff: NON_NEGATIVE_COUNT,
    avg_monthly_visits: NON_NEGATIVE_NUMBER,
    avg_report_submission_rate: PERCENTAGE,
    overloaded_count: NON_NEGATIVE_COUNT,
    underutilized_count: NON_NEGATIVE_COUNT,
  })
  .strict();

const staffMetricsDataSchema = z
  .object({
    month: z.string().regex(MONTH_PATTERN),
    summary: staffMetricsSummarySchema,
    items: z.array(staffMetricItemSchema),
  })
  .strict()
  .superRefine(({ summary, items }, context) => {
    const staffIds = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (staffIds.has(item.id)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: 'Duplicate staff metric item',
        });
      }
      staffIds.add(item.id);
    }

    if (summary.total_staff !== items.length) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'total_staff'],
        message: 'Summary total_staff must match items length',
      });
    }

    const overloadedCount = items.filter(
      (item) => item.workload_balance_delta_percent >= 20,
    ).length;
    if (summary.overloaded_count !== overloadedCount) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'overloaded_count'],
        message: 'Summary overloaded_count must match item thresholds',
      });
    }

    const underutilizedCount = items.filter(
      (item) => item.workload_balance_delta_percent <= -20,
    ).length;
    if (summary.underutilized_count !== underutilizedCount) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'underutilized_count'],
        message: 'Summary underutilized_count must match item thresholds',
      });
    }

    const averageMonthlyVisits =
      items.length > 0
        ? Math.round(
            (items.reduce((total, item) => total + item.monthly_visit_count, 0) / items.length) *
              10,
          ) / 10
        : 0;
    if (summary.avg_monthly_visits !== averageMonthlyVisits) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'avg_monthly_visits'],
        message: 'Summary avg_monthly_visits must match item values',
      });
    }

    const averageReportSubmissionRate =
      items.length > 0
        ? Math.round(
            items.reduce((total, item) => total + item.report_submission_rate, 0) / items.length,
          )
        : 0;
    if (summary.avg_report_submission_rate !== averageReportSubmissionRate) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'avg_report_submission_rate'],
        message: 'Summary avg_report_submission_rate must match item values',
      });
    }
  });

const staffMetricsResponseSchema = z
  .object({
    data: staffMetricsDataSchema,
  })
  .strict();

export function buildStaffMetricsResponseSchema(expectedMonth: string) {
  const normalizedExpectedMonth = expectedMonth.trim();
  return staffMetricsResponseSchema.superRefine(({ data }, context) => {
    if (data.month !== normalizedExpectedMonth) {
      context.addIssue({
        code: 'custom',
        path: ['data', 'month'],
        message: 'Response month does not match the requested month',
      });
    }
  });
}

export type StaffMetricItem = z.infer<typeof staffMetricItemSchema>;
export type StaffMetricsResponse = z.infer<typeof staffMetricsResponseSchema>;
