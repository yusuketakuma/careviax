import { describe, expect, it } from 'vitest';
import { performanceRuntimeResponseSchema } from './performance-runtime-schema';

const ROUTE = {
  route: '/api/patients/board',
  method: 'GET',
  org_scope: 'with_org',
  critical_route: true,
  critical_route_family: 'patients-board',
  request_count: 12,
  error_count: 1,
  slow_count: 2,
  slow_rate: 16.7,
  average_ms: 90,
  p50_ms: 80,
  p95_ms: 140,
  p99_ms: 150,
  max_ms: 160,
  payload_sample_count: 12,
  average_payload_bytes: 310_000,
  p95_payload_bytes: 327_680,
  max_payload_bytes: 330_000,
  query_count_sample_count: 12,
  average_query_count: 4,
  p95_query_count: 5,
  max_query_count: 6,
  payload_budget_bytes: 307_200,
  payload_budget_status: 'over_budget',
  payload_budget_met: false,
  payload_budget_over_count: 3,
  last_seen_at: '2026-07-12T12:00:00.000Z',
  last_status: 200,
  last_payload_bytes: 327_680,
  target_met: true,
  samples: [{ patient_id: 'provider-only' }],
} as const;

const SNAPSHOT = {
  data: {
    scope: 'current-process',
    target_ms: 500,
    collected_since: '2026-07-12T11:00:00.000Z',
    summary: {
      route_count: 1,
      total_requests: 12,
      slow_requests: 2,
      error_requests: 1,
      slow_request_rate: 16.7,
      overall_p50_ms: 80,
      overall_p95_ms: 140,
      overall_p99_ms: 150,
      overall_p95_payload_bytes: 327_680,
      overall_p95_query_count: 5,
      critical_routes: 1,
      payload_budgeted_routes: 1,
      routes_over_payload_budget: 1,
      routes_with_unconfigured_payload_budget: 0,
      routes_over_target: 0,
    },
    routes: [ROUTE],
    raw_store: { samples: [{ patient_id: 'provider-only' }] },
  },
};

describe('performanceRuntimeResponseSchema', () => {
  it('projects only operational runtime metrics used by the page', () => {
    const parsed = performanceRuntimeResponseSchema.parse(SNAPSHOT);

    expect(parsed.data).not.toHaveProperty('raw_store');
    expect(parsed.data.routes[0]).not.toHaveProperty('samples');
  });

  it.each([
    ['legacy root', SNAPSHOT.data],
    [
      'duplicate route identity',
      {
        data: {
          ...SNAPSHOT.data,
          summary: { ...SNAPSHOT.data.summary, route_count: 2 },
          routes: [ROUTE, ROUTE],
        },
      },
    ],
    [
      'unordered latency percentiles',
      { data: { ...SNAPSHOT.data, routes: [{ ...ROUTE, p99_ms: 130 }] } },
    ],
    [
      'contradictory target result',
      { data: { ...SNAPSHOT.data, routes: [{ ...ROUTE, target_met: false }] } },
    ],
    [
      'contradictory payload budget result',
      {
        data: {
          ...SNAPSHOT.data,
          routes: [{ ...ROUTE, payload_budget_status: 'within_budget' }],
        },
      },
    ],
    [
      'sample count above request count',
      { data: { ...SNAPSHOT.data, routes: [{ ...ROUTE, payload_sample_count: 13 }] } },
    ],
    [
      'slow rate inconsistent with counts',
      { data: { ...SNAPSHOT.data, routes: [{ ...ROUTE, slow_rate: 25 }] } },
    ],
    [
      'summary route subtotal above route count',
      {
        data: {
          ...SNAPSHOT.data,
          summary: { ...SNAPSHOT.data.summary, routes_over_target: 2 },
        },
      },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(performanceRuntimeResponseSchema.safeParse(payload).success).toBe(false);
  });
});
