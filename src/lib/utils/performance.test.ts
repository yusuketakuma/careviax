import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { putMetricsMock } = vi.hoisted(() => ({
  putMetricsMock: vi.fn(),
}));

vi.mock('@/lib/aws/cloudwatch', () => ({
  putMetrics: putMetricsMock,
  StandardUnit: {
    Count: 'Count',
    Milliseconds: 'Milliseconds',
    Percent: 'Percent',
  },
}));

import {
  ROUTE_QUERY_COUNT_HEADER,
  flushPerformanceMetricsToCloudWatch,
  getPerformanceSnapshot,
  recordRoutePerformance,
  resetPerformanceMetrics,
  withRoutePerformance,
} from './performance';

describe('performance metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPerformanceMetrics();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(snapshot.summary.overall_p99_ms).toBe(620);
    expect(snapshot.summary.overall_p95_payload_bytes).toBe(6200);
    expect(snapshot.summary.critical_routes).toBe(0);
    expect(snapshot.summary.payload_budgeted_routes).toBe(0);
    expect(snapshot.summary.routes_over_payload_budget).toBe(0);
    expect(snapshot.summary.routes_with_unconfigured_payload_budget).toBe(0);
    expect(snapshot.summary.routes_over_target).toBe(2);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/visit-schedules',
      method: 'GET',
      org_scope: 'without_org',
      critical_route: false,
      critical_route_family: null,
      request_count: 5,
      slow_count: 2,
      p95_ms: 620,
      p99_ms: 620,
      payload_sample_count: 5,
      average_payload_bytes: 3360,
      p95_payload_bytes: 6200,
      max_payload_bytes: 6200,
      payload_budget_bytes: null,
      payload_budget_status: 'unconfigured',
      payload_budget_met: null,
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
      critical_route: true,
      critical_route_family: 'patients-board',
      payload_budget_bytes: 300 * 1024,
      payload_budget_status: 'within_budget',
      payload_budget_met: true,
      last_payload_bytes: 11,
      org_scope: 'without_org',
    });
  });

  it('records query count from an internal response header and strips it before returning', async () => {
    const request = {
      method: 'GET',
      nextUrl: { pathname: '/api/prescription-intakes' },
    } as Parameters<typeof withRoutePerformance>[0];

    const response = await withRoutePerformance(
      request,
      async () =>
        new Response('{"data":[]}', {
          status: 200,
          headers: {
            'content-length': '11',
            [ROUTE_QUERY_COUNT_HEADER]: '4',
          },
        }),
    );

    expect(response.headers.has(ROUTE_QUERY_COUNT_HEADER)).toBe(false);
    const snapshot = getPerformanceSnapshot();
    expect(snapshot.summary.overall_p95_query_count).toBe(4);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/prescription-intakes',
      query_count_sample_count: 1,
      average_query_count: 4,
      p95_query_count: 4,
      max_query_count: 4,
    });
  });

  it('marks route summaries as mixed when samples include both org-scoped and unscoped requests', () => {
    recordRoutePerformance({
      route: '/api/patients/board',
      method: 'GET',
      status: 200,
      durationMs: 100,
      orgScopePresent: true,
    });
    recordRoutePerformance({
      route: '/api/patients/board',
      method: 'GET',
      status: 200,
      durationMs: 120,
      orgScopePresent: false,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/patients/board',
      org_scope: 'mixed',
    });
  });

  it('marks critical route payload budgets using normalized route keys', () => {
    recordRoutePerformance({
      route: '/api/patients/patient_123456/overview',
      method: 'GET',
      status: 200,
      durationMs: 120,
      payloadBytes: 260 * 1024,
    });
    recordRoutePerformance({
      route: '/api/patients/board',
      method: 'GET',
      status: 200,
      durationMs: 90,
      payloadBytes: 320 * 1024,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.summary.payload_budgeted_routes).toBe(2);
    expect(snapshot.summary.routes_over_payload_budget).toBe(2);
    expect(snapshot.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: '/api/patients/:id/overview',
          critical_route: true,
          critical_route_family: 'patient-detail-initial',
          payload_budget_bytes: 250 * 1024,
          payload_budget_status: 'over_budget',
          payload_budget_met: false,
          payload_budget_over_count: 1,
        }),
        expect.objectContaining({
          route: '/api/patients/board',
          critical_route: true,
          critical_route_family: 'patients-board',
          payload_budget_bytes: 300 * 1024,
          payload_budget_status: 'over_budget',
          payload_budget_met: false,
          payload_budget_over_count: 1,
        }),
      ]),
    );
  });

  it('marks care report list/search payload budgets after stripping query strings', () => {
    recordRoutePerformance({
      route: '/api/care-reports?keyword=%E7%9C%A0%E6%B0%97&limit=100',
      method: 'GET',
      status: 200,
      durationMs: 120,
      payloadBytes: 251 * 1024,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.summary.payload_budgeted_routes).toBe(1);
    expect(snapshot.summary.routes_over_payload_budget).toBe(1);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/care-reports',
      method: 'GET',
      critical_route: true,
      critical_route_family: 'care-reports-list-search',
      payload_budget_bytes: 250 * 1024,
      payload_budget_status: 'over_budget',
      payload_budget_met: false,
      payload_budget_over_count: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain('keyword=');
    expect(JSON.stringify(snapshot)).not.toContain('%E7%9C%A0%E6%B0%97');
  });

  it('marks dashboard segment payload budgets after stripping query strings', () => {
    recordRoutePerformance({
      route: '/api/dashboard/cockpit/details?scope=team',
      method: 'GET',
      status: 200,
      durationMs: 120,
      payloadBytes: 301 * 1024,
    });
    recordRoutePerformance({
      route: '/api/dashboard/cockpit/inbound?scope=mine',
      method: 'GET',
      status: 200,
      durationMs: 80,
      payloadBytes: 42 * 1024,
    });
    recordRoutePerformance({
      route: '/api/dashboard/cockpit/comments?scope=team',
      method: 'GET',
      status: 200,
      durationMs: 60,
      payloadBytes: 81 * 1024,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 10 });

    expect(snapshot.summary.payload_budgeted_routes).toBe(3);
    expect(snapshot.summary.routes_over_payload_budget).toBe(2);
    expect(snapshot.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: '/api/dashboard/cockpit/details',
          critical_route: true,
          critical_route_family: 'dashboard-details',
          payload_budget_bytes: 300 * 1024,
          payload_budget_status: 'over_budget',
          payload_budget_met: false,
          payload_budget_over_count: 1,
        }),
        expect.objectContaining({
          route: '/api/dashboard/cockpit/inbound',
          critical_route: true,
          critical_route_family: 'dashboard-inbound',
          payload_budget_bytes: 160 * 1024,
          payload_budget_status: 'within_budget',
          payload_budget_met: true,
          payload_budget_over_count: 0,
        }),
        expect.objectContaining({
          route: '/api/dashboard/cockpit/comments',
          critical_route: true,
          critical_route_family: 'dashboard-comments',
          payload_budget_bytes: 80 * 1024,
          payload_budget_status: 'over_budget',
          payload_budget_met: false,
          payload_budget_over_count: 1,
        }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain('scope=');
  });

  it('marks patient movement timeline payload budgets using normalized patient ids', () => {
    recordRoutePerformance({
      route: '/api/patients/patient_123456/timeline?limit=40',
      method: 'GET',
      status: 200,
      durationMs: 90,
      payloadBytes: 251 * 1024,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.summary.payload_budgeted_routes).toBe(1);
    expect(snapshot.summary.routes_over_payload_budget).toBe(1);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/patients/:id/timeline',
      method: 'GET',
      critical_route: true,
      critical_route_family: 'patient-movement-timeline-list',
      payload_budget_bytes: 250 * 1024,
      payload_budget_status: 'over_budget',
      payload_budget_met: false,
      payload_budget_over_count: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain('patient_123456');
    expect(JSON.stringify(snapshot)).not.toContain('limit=');
  });

  it('marks inbound and medication stock payload budgets using normalized route keys', () => {
    recordRoutePerformance({
      route: '/api/communications/inbound?status=needs_review&channel=mcs',
      method: 'GET',
      status: 200,
      durationMs: 70,
      payloadBytes: 161 * 1024,
    });
    recordRoutePerformance({
      route: '/api/communications/inbound/signals?domain=medication_stock',
      method: 'GET',
      status: 200,
      durationMs: 80,
      payloadBytes: 80 * 1024,
    });
    recordRoutePerformance({
      route: '/api/patients/patient_123456/medication-stock?item_limit=100',
      method: 'GET',
      status: 200,
      durationMs: 90,
      payloadBytes: 251 * 1024,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 10 });

    expect(snapshot.summary.payload_budgeted_routes).toBe(3);
    expect(snapshot.summary.routes_over_payload_budget).toBe(2);
    expect(snapshot.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: '/api/communications/inbound',
          method: 'GET',
          critical_route: true,
          critical_route_family: 'communications-inbound-inbox',
          payload_budget_bytes: 160 * 1024,
          payload_budget_status: 'over_budget',
          payload_budget_met: false,
          payload_budget_over_count: 1,
        }),
        expect.objectContaining({
          route: '/api/communications/inbound/signals',
          method: 'GET',
          critical_route: true,
          critical_route_family: 'communications-inbound-signals',
          payload_budget_bytes: 160 * 1024,
          payload_budget_status: 'within_budget',
          payload_budget_met: true,
          payload_budget_over_count: 0,
        }),
        expect.objectContaining({
          route: '/api/patients/:id/medication-stock',
          method: 'GET',
          critical_route: true,
          critical_route_family: 'patient-medication-stock-summary',
          payload_budget_bytes: 250 * 1024,
          payload_budget_status: 'over_budget',
          payload_budget_met: false,
          payload_budget_over_count: 1,
        }),
      ]),
    );
    expect(JSON.stringify(snapshot)).not.toContain('status=needs_review');
    expect(JSON.stringify(snapshot)).not.toContain('domain=medication_stock');
    expect(JSON.stringify(snapshot)).not.toContain('patient_123456');
    expect(JSON.stringify(snapshot)).not.toContain('item_limit=');
  });

  it('drops query strings and hash fragments before route bucketing', () => {
    recordRoutePerformance({
      route: '/api/patients/board?search=patient-name&org_id=org_1#section',
      method: 'GET',
      status: 200,
      durationMs: 120,
      payloadBytes: 10,
    });
    recordRoutePerformance({
      route: 'https://example.test/api/patients/board?search=other-patient',
      method: 'GET',
      status: 200,
      durationMs: 90,
      payloadBytes: 10,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.summary.route_count).toBe(1);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/patients/board',
      request_count: 2,
      critical_route: true,
      payload_budget_status: 'within_budget',
    });
    expect(JSON.stringify(snapshot)).not.toContain('patient-name');
    expect(JSON.stringify(snapshot)).not.toContain('org_1');
    expect(JSON.stringify(snapshot)).not.toContain('search=');
  });

  it('marks critical route families without configured budgets as unconfigured', () => {
    recordRoutePerformance({
      route: '/api/billing/close-board?month=2026-07',
      method: 'GET',
      status: 200,
      durationMs: 150,
      payloadBytes: 2048,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.summary.critical_routes).toBe(1);
    expect(snapshot.summary.payload_budgeted_routes).toBe(0);
    expect(snapshot.summary.routes_with_unconfigured_payload_budget).toBe(1);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/billing/close-board',
      critical_route: true,
      critical_route_family: 'billing',
      payload_budget_bytes: null,
      payload_budget_status: 'unconfigured',
      payload_budget_met: null,
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

  it('flushes p99 and payload-budget metrics with deployment dimensions for CloudWatch', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('DEPLOY_SHA', 'sha value with spaces');
    vi.stubEnv('PHOS_INSTANCE_ID', 'task/instance one');
    putMetricsMock.mockResolvedValue(undefined);

    recordRoutePerformance({
      route: '/api/patients/board',
      method: 'GET',
      status: 200,
      durationMs: 100,
      payloadBytes: 320 * 1024,
      orgScopePresent: true,
    });
    recordRoutePerformance({
      route: '/api/patients/board',
      method: 'GET',
      status: 200,
      durationMs: 640,
      payloadBytes: 10,
      orgScopePresent: true,
    });

    await flushPerformanceMetricsToCloudWatch({ topRoutes: 5 });

    expect(putMetricsMock).toHaveBeenCalledTimes(1);
    const metricData = putMetricsMock.mock.calls[0]?.[0] as Array<{
      MetricName: string;
      Value: number;
      Unit: string;
      Dimensions: Array<{ Name: string; Value: string }>;
    }>;

    expect(metricData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          MetricName: 'RouteP99LatencyMs',
          Value: 640,
          Unit: 'Milliseconds',
          Dimensions: expect.arrayContaining([
            { Name: 'Route', Value: '/api/patients/board' },
            { Name: 'Method', Value: 'GET' },
            { Name: 'OrgScope', Value: 'with_org' },
            { Name: 'Environment', Value: 'staging' },
            { Name: 'DeploySha', Value: 'sha_value_with_spaces' },
            { Name: 'InstanceId', Value: 'task/instance_one' },
          ]),
        }),
        expect.objectContaining({
          MetricName: 'RoutePayloadBudgetOverCount',
          Value: 1,
          Unit: 'Count',
        }),
        expect.objectContaining({
          MetricName: 'OverallP99LatencyMs',
          Value: 640,
          Unit: 'Milliseconds',
          Dimensions: expect.arrayContaining([
            { Name: 'OrgScope', Value: 'aggregate' },
            { Name: 'Environment', Value: 'staging' },
            { Name: 'DeploySha', Value: 'sha_value_with_spaces' },
            { Name: 'InstanceId', Value: 'task/instance_one' },
          ]),
        }),
        expect.objectContaining({
          MetricName: 'PayloadBudgetOverRoutes',
          Value: 1,
          Unit: 'Count',
        }),
      ]),
    );
    expect(metricData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          MetricName: 'OverallP99LatencyMs',
          Dimensions: [{ Name: 'OrgScope', Value: 'aggregate' }],
        }),
        expect.objectContaining({
          MetricName: 'PayloadBudgetOverRoutes',
          Dimensions: [{ Name: 'OrgScope', Value: 'aggregate' }],
        }),
      ]),
    );
    expect(JSON.stringify(metricData)).not.toContain('org_');
  });
});
