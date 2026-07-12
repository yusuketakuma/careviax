import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const count = z.number().int().nonnegative();
const percent = z.number().int().min(0).max(100);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const offsetDateTime = z.string().datetime({ offset: true });
const rate = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);

const monthlyBucketSchema = z
  .object({
    month,
    attempted_count: count,
    success_count: count,
    failed_count: count,
    confirmed_count: count,
    response_waiting_count: count,
    success_rate: percent,
    confirmed_rate: percent,
  })
  .strict();

const physicianBucketSchema = z
  .object({
    recipient_name: text(500),
    total_count: count,
    success_count: count,
    confirmed_count: count,
    success_rate: percent,
  })
  .strict();

const channelBucketSchema = z
  .object({
    channel: text(100),
    total_count: count,
    success_count: count,
    failed_count: count,
    success_rate: percent,
  })
  .strict();

const overdueItemSchema = z
  .object({
    id: text(200),
    report_id: text(200),
    patient_id: text(200),
    patient_name: text(500),
    report_type: text(100),
    recipient_name: text(500),
    recipient_contact: text(500),
    channel: text(100),
    sent_at: offsetDateTime,
    days_waiting: count,
  })
  .passthrough()
  .transform(
    ({
      id,
      report_id,
      patient_id,
      patient_name,
      report_type,
      recipient_name,
      recipient_contact,
      channel,
      sent_at,
      days_waiting,
    }) => ({
      id,
      report_id,
      patient_id,
      patient_name,
      report_type,
      recipient_name,
      recipient_contact,
      channel,
      sent_at,
      days_waiting,
    }),
  );

export function buildDeliveryAnalyticsResponseSchema(overdueDays: number) {
  return z
    .object({
      data: z
        .object({
          summary: z
            .object({
              current_month: month,
              current_month_attempted_count: count,
              current_month_success_rate: percent,
              current_month_failed_count: count,
              current_month_confirmed_rate: percent,
              overdue_waiting_count: count,
              overdue_threshold_days: z.literal(overdueDays),
            })
            .strict(),
          monthly_trend: z.array(monthlyBucketSchema).max(24),
          physician_breakdown: z.array(physicianBucketSchema).max(5),
          channel_breakdown: z.array(channelBucketSchema).max(20),
          overdue_waiting: z.array(overdueItemSchema).max(1_000),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const monthIds = new Set<string>();
      let previousMonth: string | null = null;
      for (const [index, bucket] of data.monthly_trend.entries()) {
        if (monthIds.has(bucket.month) || (previousMonth && bucket.month <= previousMonth))
          context.addIssue({
            code: 'custom',
            path: ['data', 'monthly_trend', index, 'month'],
            message: 'Monthly delivery buckets are duplicate or unordered',
          });
        monthIds.add(bucket.month);
        previousMonth = bucket.month;
        if (
          bucket.success_count + bucket.failed_count !== bucket.attempted_count ||
          bucket.confirmed_count > bucket.success_count ||
          bucket.response_waiting_count > bucket.success_count ||
          bucket.success_rate !== rate(bucket.success_count, bucket.attempted_count) ||
          bucket.confirmed_rate !== rate(bucket.confirmed_count, bucket.attempted_count)
        )
          context.addIssue({
            code: 'custom',
            path: ['data', 'monthly_trend', index],
            message: 'Monthly delivery aggregate drift',
          });
      }
      const current = data.monthly_trend.find(
        (bucket) => bucket.month === data.summary.current_month,
      );
      if (
        !current ||
        data.summary.current_month_attempted_count !== current.attempted_count ||
        data.summary.current_month_success_rate !== current.success_rate ||
        data.summary.current_month_failed_count !== current.failed_count ||
        data.summary.current_month_confirmed_rate !== current.confirmed_rate
      )
        context.addIssue({
          code: 'custom',
          path: ['data', 'summary'],
          message: 'Current month delivery summary drift',
        });
      if (data.summary.overdue_waiting_count !== data.overdue_waiting.length)
        context.addIssue({
          code: 'custom',
          path: ['data', 'summary', 'overdue_waiting_count'],
          message: 'Overdue delivery count drift',
        });
      const deliveryIds = new Set<string>();
      let previousDays: number | null = null;
      for (const [index, item] of data.overdue_waiting.entries()) {
        if (
          deliveryIds.has(item.id) ||
          item.days_waiting < overdueDays ||
          (previousDays !== null && item.days_waiting > previousDays)
        )
          context.addIssue({
            code: 'custom',
            path: ['data', 'overdue_waiting', index],
            message: 'Overdue delivery identity, threshold, or order drift',
          });
        deliveryIds.add(item.id);
        previousDays = item.days_waiting;
      }
      for (const [key, buckets] of [
        ['physician_breakdown', data.physician_breakdown],
        ['channel_breakdown', data.channel_breakdown],
      ] as const) {
        const ids = new Set<string>();
        for (const [index, bucket] of buckets.entries()) {
          const identity = 'recipient_name' in bucket ? bucket.recipient_name : bucket.channel;
          if (
            ids.has(identity) ||
            bucket.success_count + ('failed_count' in bucket ? bucket.failed_count : 0) >
              bucket.total_count ||
            bucket.success_rate !== rate(bucket.success_count, bucket.total_count)
          )
            context.addIssue({
              code: 'custom',
              path: ['data', key, index],
              message: 'Delivery breakdown aggregate drift',
            });
          ids.add(identity);
        }
      }
    });
}

export function buildReminderMutationResponseSchema(requestedDeliveryIds?: string[]) {
  return z
    .object({
      data: z
        .object({
          queued_count: count,
          reminder_task_count: count,
          queued_delivery_count: count,
          delivery_ids: z.array(text(191)).max(50),
          skipped_snoozed_count: count,
          skipped_snoozed_dedupe_keys: z.array(text(500)).max(50),
        })
        .strict(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      if (
        data.queued_count !== data.reminder_task_count ||
        data.queued_delivery_count !== data.delivery_ids.length ||
        data.skipped_snoozed_count !== data.skipped_snoozed_dedupe_keys.length ||
        new Set(data.delivery_ids).size !== data.delivery_ids.length
      )
        context.addIssue({
          code: 'custom',
          path: ['data'],
          message: 'Reminder result count drift',
        });
      if (requestedDeliveryIds) {
        const requested = new Set(requestedDeliveryIds);
        if (data.delivery_ids.some((id) => !requested.has(id)))
          context.addIssue({
            code: 'custom',
            path: ['data', 'delivery_ids'],
            message: 'Reminder result contains an unrequested delivery',
          });
      }
    })
    .transform(({ data }) => ({ data: { queued_count: data.queued_count } }));
}
