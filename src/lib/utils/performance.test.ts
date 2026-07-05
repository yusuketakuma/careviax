import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPerformanceSnapshot,
  recordRoutePerformance,
  resetPerformanceMetrics,
  withRoutePerformance,
} from './performance';

describe('performance metrics', () => {
  beforeEach(() => {
    resetPerformanceMetrics();
  });

  it('aggregates per-route and overall percentiles', () => {
    [120, 180, 220, 540, 620].forEach((durationMs) => {
      recordRoutePerformance({
        route: '/api/visit-schedules',
        method: 'GET',
        status: 200,
        durationMs,
        payloadBytes: durationMs * 10,
      });
    });
    [60, 75, 90].forEach((durationMs) => {
      recordRoutePerformance({
        route: '/api/dashboard/workflow',
        method: 'GET',
        status: 200,
        durationMs,
      });
    });
    recordRoutePerformance({
      route: '/api/dashboard/workflow',
      method: 'GET',
      status: 503,
      durationMs: 510,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.summary.total_requests).toBe(9);
    expect(snapshot.summary.slow_requests).toBe(3);
    expect(snapshot.summary.error_requests).toBe(1);
    expect(snapshot.summary.overall_p50_ms).toBe(180);
    expect(snapshot.summary.overall_p95_ms).toBe(620);
    expect(snapshot.summary.overall_p95_payload_bytes).toBe(6200);
    expect(snapshot.summary.routes_over_target).toBe(2);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/visit-schedules',
      method: 'GET',
      request_count: 5,
      slow_count: 2,
      p95_ms: 620,
      payload_sample_count: 5,
      average_payload_bytes: 3360,
      p95_payload_bytes: 6200,
      max_payload_bytes: 6200,
      target_met: false,
    });
  });

  it('tracks wrapped responses and excludes the performance route itself', async () => {
    const request = {
      method: 'GET',
      nextUrl: { pathname: '/api/admin/performance-metrics' },
    } as Parameters<typeof withRoutePerformance>[0];

    await withRoutePerformance(request, async () => new Response(null, { status: 200 }));

    const snapshot = getPerformanceSnapshot();
    expect(snapshot.summary.total_requests).toBe(0);
  });

  it('records payload bytes from explicit response content-length without reading the body', async () => {
    const request = {
      method: 'GET',
      nextUrl: { pathname: '/api/patients/board' },
    } as Parameters<typeof withRoutePerformance>[0];

    await withRoutePerformance(
      request,
      async () => new Response('{"data":[]}', { status: 200, headers: { 'content-length': '11' } }),
    );

    const snapshot = getPerformanceSnapshot();
    expect(snapshot.summary.overall_p95_payload_bytes).toBe(11);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/patients/board',
      method: 'GET',
      payload_sample_count: 1,
      average_payload_bytes: 11,
      p95_payload_bytes: 11,
      max_payload_bytes: 11,
      last_payload_bytes: 11,
    });
  });

  it('normalizes dynamic route ids into a single metrics bucket', () => {
    for (let index = 0; index < 1_000; index += 1) {
      recordRoutePerformance({
        route: `/api/patients/cmnhpatient${index.toString().padStart(4, '0')}amq9ph-os/overview`,
        method: 'GET',
        status: 200,
        durationMs: 40 + (index % 5),
      });
    }

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.summary.route_count).toBe(1);
    expect(snapshot.summary.total_requests).toBe(200);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/patients/:id/overview',
      method: 'GET',
      request_count: 200,
    });
  });

  it('caps total route buckets for unknown high-cardinality paths', () => {
    for (let index = 0; index < 600; index += 1) {
      const suffix = [
        String.fromCharCode(97 + (index % 26)),
        String.fromCharCode(97 + (Math.floor(index / 26) % 26)),
        String.fromCharCode(97 + (Math.floor(index / (26 * 26)) % 26)),
      ].join('');

      recordRoutePerformance({
        route: `/api/custom/static-path-${suffix}`,
        method: 'GET',
        status: 200,
        durationMs: 20,
      });
    }

    const snapshot = getPerformanceSnapshot({ topRoutes: 600 });

    expect(snapshot.summary.route_count).toBeLessThanOrEqual(500);
    expect(snapshot.summary.total_requests).toBeLessThanOrEqual(500);
  });
});
