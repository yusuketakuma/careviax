import { describe, expect, it } from 'vitest';
import {
  intakeCockpitResponseSchema,
  intakeTriageResponseSchema,
} from './intake-triage-response-schema';

function buildTriage() {
  return {
    data: {
      generated_at: '2026-07-13T00:00:00.000Z',
      new_today_count: 1,
      needs_decision_count: 1,
      lane_counts: { fax: 1, online: 0, walk_in: 0 },
      rows: [
        {
          intake_id: 'intake_1',
          cycle_id: 'cycle_1',
          patient_id: 'patient_1',
          patient_name: '患者 一郎',
          received_at: '2026-07-13T00:00:00.000Z',
          lane: 'fax',
          issuer: null,
          content_label: '定期処方',
          rx_number: null,
          auto_read_percent: 95,
          status: 'duplicate_suspected',
          duplicate_of_date: '7/12',
          action: 'compare',
        },
      ],
      duplicate_notices: [
        { intake_id: 'intake_1', patient_name: '患者 一郎', lane: 'fax', matched_date: '7/12' },
      ],
      evidence: { fax_document_count: 1, reader_model_version: 'v1', discard_count_this_month: 0 },
    },
  };
}

describe('intake triage response schemas', () => {
  it('accepts an internally consistent triage response', () => {
    expect(intakeTriageResponseSchema.parse(buildTriage()).data.rows).toHaveLength(1);
  });

  it.each([
    [
      'lane count drift',
      (payload: ReturnType<typeof buildTriage>) => {
        payload.data.lane_counts.fax = 0;
      },
    ],
    [
      'duplicate identity',
      (payload: ReturnType<typeof buildTriage>) => {
        payload.data.rows.push({ ...payload.data.rows[0]! });
      },
    ],
    [
      'duplicate notice drift',
      (payload: ReturnType<typeof buildTriage>) => {
        payload.data.duplicate_notices[0]!.patient_name = '別患者';
      },
    ],
    [
      'decision count drift',
      (payload: ReturnType<typeof buildTriage>) => {
        payload.data.needs_decision_count = 0;
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const payload = buildTriage();
    mutate(payload);
    expect(intakeTriageResponseSchema.safeParse(payload).success).toBe(false);
  });

  it('projects the cockpit response to fields consumed by the intake rail', () => {
    const result = intakeCockpitResponseSchema.parse({
      data: {
        generated_at: '2026-07-13T00:00:00.000Z',
        audit_queue: [],
        today_visits: [],
        blocked_reasons: [],
        comments: [{ content_excerpt: 'unused PHI-adjacent field' }],
      },
    });
    expect(result.data).toStrictEqual({ audit_queue: [], today_visits: [], blocked_reasons: [] });
  });

  it('rejects an unsafe blocked-reason action URL', () => {
    expect(
      intakeCockpitResponseSchema.safeParse({
        data: {
          audit_queue: [],
          today_visits: [],
          blocked_reasons: [
            {
              id: 'blocked_1',
              label: '確認待ち',
              severity: 'warning',
              category: null,
              age_minutes: 1,
              action_label: '確認',
              action_href: 'https://evil.example',
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
