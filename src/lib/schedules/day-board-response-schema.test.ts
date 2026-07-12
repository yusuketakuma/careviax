import { describe, expect, it } from 'vitest';
import { buildScheduleDayBoardResponseSchema } from './day-board-response-schema';

const DATE = '2026-07-13';

function board(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: '2026-07-13T00:00:00.000Z',
    date: DATE,
    staff: [],
    staff_counts: {
      total_count: 0,
      visible_count: 0,
      hidden_count: 0,
      total_visit_count: 0,
      visible_visit_count: 0,
      hidden_visit_count: 0,
      total_preparation_attention_count: 0,
      visible_preparation_attention_count: 0,
      hidden_preparation_attention_count: 0,
      hidden_operational_task_count: 0,
      limit: 6,
    },
    audit_pending_count: 0,
    report_pending_count: 0,
    vehicle_resources: [],
    pending_proposals: [],
    pending_proposal_counts: {
      total_count: 0,
      visible_count: 0,
      hidden_count: 0,
      limit: 3,
      hidden_operational_task_count: 0,
    },
    inbound_schedule_requests: [],
    inbound_schedule_request_counts: {
      total_count: 0,
      visible_count: 0,
      hidden_count: 0,
      limit: 5,
      count_basis: 'formal_schedule_signal_visible_window',
    },
    operational_tasks: [],
    ...overrides,
  };
}

describe('schedule day-board response schema', () => {
  it('accepts the complete empty board for the requested date', () => {
    expect(buildScheduleDayBoardResponseSchema(DATE).parse({ data: board() }).data.date).toBe(DATE);
  });

  it('rejects a successful response for another requested date', () => {
    expect(
      buildScheduleDayBoardResponseSchema(DATE).safeParse({
        data: board({ date: '2026-07-14' }),
      }).success,
    ).toBe(false);
  });

  it('rejects hidden and visible workload aggregate drift', () => {
    expect(
      buildScheduleDayBoardResponseSchema(DATE).safeParse({
        data: board({
          staff_counts: {
            ...board().staff_counts,
            total_count: 1,
          },
        }),
      }).success,
    ).toBe(false);
  });

  it('rejects impossible vehicle capacity and duplicate recommendations', () => {
    const vehicle = {
      id: 'vehicle_1',
      label: '軽バン1号',
      site_id: 'site_1',
      vehicle_code: 'V-1',
      travel_mode: 'DRIVE',
      available: true,
      max_stops: 4,
      max_route_duration_minutes: null,
      assigned_visit_count: 2,
      remaining_stops: 3,
      route_duration_minutes: null,
      route_duration_status: 'not_limited',
      route_duration_label: '稼働上限なし',
      recommended: true,
      recommendation_reason: '空きあり',
    };

    expect(
      buildScheduleDayBoardResponseSchema(DATE).safeParse({
        data: board({
          vehicle_resources: [vehicle, { ...vehicle, id: 'vehicle_2' }],
        }),
      }).success,
    ).toBe(false);
  });

  it('strips provider-only vehicle recommendation inputs before caching', () => {
    const parsed = buildScheduleDayBoardResponseSchema(DATE).parse({
      data: board({
        vehicle_resources: [
          {
            id: 'vehicle_1',
            label: '軽バン1号',
            site_id: 'site_1',
            vehicle_code: 'V-1',
            travel_mode: 'DRIVE',
            available: true,
            max_stops: 4,
            max_route_duration_minutes: null,
            assigned_visit_count: 2,
            remaining_stops: 2,
            route_duration_minutes: null,
            route_duration_status: 'not_limited',
            route_duration_label: '稼働上限なし',
            recommended: false,
            recommendation_reason: '空きあり',
            matching_unassigned_visit_count: 2,
          },
        ],
      }),
    });

    expect(parsed.data.vehicle_resources[0]).not.toHaveProperty('matching_unassigned_visit_count');
  });
});
