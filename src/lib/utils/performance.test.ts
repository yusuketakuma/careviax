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
    expect(snapshot.summary.routes_over_target).toBe(2);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/visit-schedules',
      method: 'GET',
      request_count: 5,
      slow_count: 2,
      p95_ms: 620,
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
});
