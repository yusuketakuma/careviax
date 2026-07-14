import { describe, expect, it } from 'vitest';
import {
  patientMovementTimelineResponseSchema,
  type PatientMovementTimelineEvent,
  type PatientMovementTimelineResponse,
} from './patient-movement-timeline';

function event(id: string, occurredAt: string): PatientMovementTimelineEvent {
  return {
    id,
    event_type: 'visit_event',
    category: 'visit',
    occurred_at: occurredAt,
    recorded_at: null,
    title: `event ${id}`,
    summary: null,
    href: `/visits/${id}`,
    action_label: '訪問を開く',
    status: 'completed',
    status_label: '完了',
    actor_name: null,
    actor_role: null,
    source_channel: 'internal',
    source_label: 'PH-OS',
    related_entity_type: 'visit_record',
    related_entity_id: id,
    severity: 'normal',
    badges: [],
    metadata: [],
    privacy_level: 'summary',
    raw_available: false,
  };
}

function responseFixture(): PatientMovementTimelineResponse {
  return {
    data: {
      movement_events: [
        event('event_b', '2026-07-14T03:00:00.000Z'),
        event('event_a', '2026-07-14T03:00:00.000Z'),
        event('event_old', '2026-07-13T03:00:00.000Z'),
      ],
    },
    meta: {
      next_cursor: null,
      has_more: false,
      returned_count: 3,
      count_basis: 'bounded_latest_window',
      filters: { category: null, date_from: null, date_to: null },
      window_limit: 40,
      selection_order: 'occurred_at_desc_id_desc',
      presentation_order: 'occurred_at_asc_id_asc',
      cursor_direction: 'older',
      is_current_window: true,
      current_event_id: 'event_b',
      presentation_terminal_event_id: 'event_b',
      window_start_at: '2026-07-13T03:00:00.000Z',
      window_end_at: '2026-07-14T03:00:00.000Z',
    },
  };
}

describe('patientMovementTimelineResponseSchema', () => {
  it('accepts the canonical latest-window selection contract', () => {
    expect(patientMovementTimelineResponseSchema.safeParse(responseFixture()).success).toBe(true);
  });

  it.each([
    [
      'invalid event timestamp',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.data.movement_events[0]!.occurred_at = '2026-07-14';
      },
    ],
    [
      'ascending selection payload',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.data.movement_events.reverse();
      },
    ],
    [
      'duplicate IDs',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.data.movement_events[1]!.id = 'event_b';
      },
    ],
    [
      'wrong returned count',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.meta.returned_count = 2;
      },
    ],
    [
      'wrong presentation terminal',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.meta.presentation_terminal_event_id = 'event_old';
      },
    ],
    [
      'wrong window boundary',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.meta.window_start_at = fixture.meta.window_end_at;
      },
    ],
    [
      'current marker on a filtered response',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.meta.filters.category = 'visit';
      },
    ],
    [
      'missing current marker on a complete current window',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.meta.current_event_id = null;
      },
    ],
    [
      'non-canonical window limit',
      (fixture: ReturnType<typeof responseFixture>) => {
        (fixture.meta as { window_limit: number }).window_limit = 50;
      },
    ],
    [
      'cursor mismatch',
      (fixture: ReturnType<typeof responseFixture>) => {
        fixture.meta.has_more = true;
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const fixture = responseFixture();
    mutate(fixture);
    expect(patientMovementTimelineResponseSchema.safeParse(fixture).success).toBe(false);
  });

  it('rejects extra response fields', () => {
    expect(
      patientMovementTimelineResponseSchema.safeParse({
        ...responseFixture(),
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it.each([
    'https://example.invalid/private',
    '//example.invalid/private',
    'javascript:alert(1)',
    '/api',
    '/api?patient_id=patient_1',
    '/api/patients/patient_1/movement-timeline',
    '/patients/patient_1/timeline',
    '/patients/patient_1/timeline/event_1',
    '/safe/../api/private',
    '/safe/%2e%2e/api/private',
    '/%61pi/private',
    '/safe%2Fapi/private',
    '/patients/patient_1/safe/../timeline/event_1',
    '/patients/patient_1/safe/%2e%2e/timeline/event_1',
    '/\\example.invalid/private',
    '/\n/evil.example/private',
    '/\r/evil.example/private',
    '/\t/evil.example/private',
  ])('rejects unsafe movement href %s', (href) => {
    const fixture = responseFixture();
    fixture.data.movement_events[0]!.href = href;
    expect(patientMovementTimelineResponseSchema.safeParse(fixture).success).toBe(false);
  });

  it('accepts only bounded internal failure keys with the fixed PHI-safe message', () => {
    const fixture = responseFixture();
    fixture.meta.current_event_id = null;
    const fixedFailureResponse = {
      ...fixture,
      data: {
        ...fixture.data,
        partial_failures: [
          {
            source: 'communicationEvents',
            message: '一部のタイムライン情報を取得できませんでした',
          },
        ],
      },
    };
    const parsedFixedFailure =
      patientMovementTimelineResponseSchema.safeParse(fixedFailureResponse);
    expect(
      parsedFixedFailure.success,
      parsedFixedFailure.success ? undefined : JSON.stringify(parsedFixedFailure.error.issues),
    ).toBe(true);

    for (const partialFailure of [
      { source: 'communicationEvents', message: '患者 山田 090-0000-0000 raw provider error' },
      {
        source: 'patient 山田 090-0000-0000',
        message: '一部のタイムライン情報を取得できませんでした',
      },
    ]) {
      expect(
        patientMovementTimelineResponseSchema.safeParse({
          ...fixedFailureResponse,
          data: { ...fixedFailureResponse.data, partial_failures: [partialFailure] },
        }).success,
      ).toBe(false);
    }
  });
});
