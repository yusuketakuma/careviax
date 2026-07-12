import { describe, expect, it } from 'vitest';
import {
  buildDeliveryAnalyticsResponseSchema,
  buildReminderMutationResponseSchema,
} from './delivery-analytics-response-schemas';

function analytics() {
  return {
    data: {
      summary: {
        current_month: '2026-07',
        current_month_attempted_count: 3,
        current_month_success_rate: 67,
        current_month_failed_count: 1,
        current_month_confirmed_rate: 33,
        overdue_waiting_count: 1,
        overdue_threshold_days: 7,
      },
      monthly_trend: [
        {
          month: '2026-07',
          attempted_count: 3,
          success_count: 2,
          failed_count: 1,
          confirmed_count: 1,
          response_waiting_count: 1,
          success_rate: 67,
          confirmed_rate: 33,
        },
      ],
      physician_breakdown: [
        {
          recipient_name: '田中医師',
          total_count: 3,
          success_count: 2,
          confirmed_count: 1,
          success_rate: 67,
        },
      ],
      channel_breakdown: [
        {
          channel: 'fax',
          total_count: 3,
          success_count: 2,
          failed_count: 1,
          success_rate: 67,
        },
      ],
      overdue_waiting: [
        {
          id: 'delivery_1',
          report_id: 'report_1',
          patient_id: 'patient_1',
          patient_name: '患者A',
          report_type: 'visit_report',
          recipient_name: '田中医師',
          recipient_contact: '03-****-0000',
          channel: 'fax',
          sent_at: '2026-07-01T00:00:00.000Z',
          days_waiting: 12,
        },
      ],
    },
  };
}

describe('delivery analytics response schemas', () => {
  it('accepts consistent analytics', () => {
    expect(
      buildDeliveryAnalyticsResponseSchema(7).parse(analytics()).data.overdue_waiting,
    ).toHaveLength(1);
  });

  it.each([
    [
      'current summary drift',
      (value: ReturnType<typeof analytics>) => {
        value.data.summary.current_month_failed_count = 0;
      },
    ],
    [
      'monthly rate drift',
      (value: ReturnType<typeof analytics>) => {
        value.data.monthly_trend[0]!.success_rate = 100;
      },
    ],
    [
      'overdue threshold drift',
      (value: ReturnType<typeof analytics>) => {
        value.data.overdue_waiting[0]!.days_waiting = 6;
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const value = analytics();
    mutate(value);
    expect(buildDeliveryAnalyticsResponseSchema(7).safeParse(value).success).toBe(false);
  });

  it('projects a consistent reminder result', () => {
    const parsed = buildReminderMutationResponseSchema(['delivery_1']).parse({
      data: {
        queued_count: 1,
        reminder_task_count: 1,
        queued_delivery_count: 1,
        delivery_ids: ['delivery_1'],
        skipped_snoozed_count: 0,
        skipped_snoozed_dedupe_keys: [],
      },
    });
    expect(parsed).toStrictEqual({ data: { queued_count: 1 } });
  });

  it('rejects an unrequested reminder result', () => {
    expect(
      buildReminderMutationResponseSchema(['delivery_1']).safeParse({
        data: {
          queued_count: 1,
          reminder_task_count: 1,
          queued_delivery_count: 1,
          delivery_ids: ['delivery_2'],
          skipped_snoozed_count: 0,
          skipped_snoozed_dedupe_keys: [],
        },
      }).success,
    ).toBe(false);
  });
});
