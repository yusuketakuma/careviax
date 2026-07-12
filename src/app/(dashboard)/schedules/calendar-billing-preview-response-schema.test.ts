import { describe, expect, it } from 'vitest';
import { buildCalendarBillingPreviewResponseSchema } from './calendar-billing-preview-response-schema';

function buildPayload() {
  return {
    data: {
      schedule_1: {
        alerts: [{ severity: 'warning', message: '内部詳細', details: { patient_id: 'p1' } }],
        cadence: {
          next_billable_date: '2026-07-14',
          scheduled_dates_current_month: ['2026-07-13'],
          reason: '内部算定理由',
        },
        effective_revision_code: '2026',
      },
    },
  };
}

describe('buildCalendarBillingPreviewResponseSchema', () => {
  it('keeps only the fields used by the calendar', () => {
    const parsed = buildCalendarBillingPreviewResponseSchema(['schedule_1']).parse(buildPayload());

    expect(parsed).toEqual({
      data: {
        schedule_1: {
          alerts: [{ severity: 'warning' }],
          cadence: { next_billable_date: '2026-07-14' },
        },
      },
    });
  });

  it.each([
    ['legacy root', () => buildPayload().data],
    ['missing requested key', () => ({ data: {} })],
    [
      'unexpected key',
      () => ({ data: { ...buildPayload().data, schedule_2: buildPayload().data.schedule_1 } }),
    ],
    [
      'invalid severity',
      () => ({
        data: {
          schedule_1: {
            alerts: [{ severity: 'critical' }],
            cadence: { next_billable_date: null },
          },
        },
      }),
    ],
    [
      'invalid next date',
      () => ({
        data: {
          schedule_1: {
            alerts: [],
            cadence: { next_billable_date: '2026-02-30' },
          },
        },
      }),
    ],
  ])('rejects %s', (_label, payloadFactory) => {
    expect(
      buildCalendarBillingPreviewResponseSchema(['schedule_1']).safeParse(payloadFactory()).success,
    ).toBe(false);
  });
});
