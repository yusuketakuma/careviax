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

function alphabeticRouteSuffix(index: number): string {
  return [
    String.fromCharCode(97 + (index % 26)),
    String.fromCharCode(97 + (Math.floor(index / 26) % 26)),
    String.fromCharCode(97 + (Math.floor(index / (26 * 26)) % 26)),
  ].join('');
}

describe('performance metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putMetricsMock.mockReset();
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

  it('records nested wrappers for the same request once while keeping distinct requests separate', async () => {
    const firstRequest = {
      method: 'GET',
      nextUrl: { pathname: '/api/communications/inbound' },
    } as Parameters<typeof withRoutePerformance>[0];
    const secondRequest = {
      method: 'GET',
      nextUrl: { pathname: '/api/communications/inbound' },
    } as Parameters<typeof withRoutePerformance>[0];

    const nestedResponse = await withRoutePerformance(firstRequest, async () =>
      withRoutePerformance(
        firstRequest,
        async () =>
          new Response('{"data":[]}', {
            status: 200,
            headers: {
              'content-length': '11',
              [ROUTE_QUERY_COUNT_HEADER]: '4',
            },
          }),
      ),
    );
    await withRoutePerformance(
      secondRequest,
      async () => new Response('{"data":[]}', { status: 200, headers: { 'content-length': '11' } }),
    );

    expect(nestedResponse.headers.has(ROUTE_QUERY_COUNT_HEADER)).toBe(false);
    await expect(nestedResponse.text()).resolves.toBe('{"data":[]}');
    expect(getPerformanceSnapshot({ topRoutes: 5 }).routes[0]).toMatchObject({
      route: '/api/communications/inbound',
      request_count: 2,
      payload_sample_count: 2,
      query_count_sample_count: 1,
      average_query_count: 4,
      last_payload_bytes: 11,
    });
  });

  it('releases the nested-request guard after an error', async () => {
    const request = {
      method: 'GET',
      nextUrl: { pathname: '/api/patients/board' },
    } as Parameters<typeof withRoutePerformance>[0];

    await expect(
      withRoutePerformance(request, async () => {
        throw new Error('expected test failure');
      }),
    ).rejects.toThrow('expected test failure');
    await withRoutePerformance(
      request,
      async () => new Response('{"data":[]}', { status: 200, headers: { 'content-length': '11' } }),
    );

    expect(getPerformanceSnapshot({ topRoutes: 5 }).routes[0]).toMatchObject({
      route: '/api/patients/board',
      request_count: 2,
      error_count: 1,
      payload_sample_count: 1,
      last_payload_bytes: 11,
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
      route: '/api/patients/patient_123456/movement-timeline?limit=40',
      method: 'GET',
      status: 200,
      durationMs: 90,
      payloadBytes: 251 * 1024,
    });

    const snapshot = getPerformanceSnapshot({ topRoutes: 5 });

    expect(snapshot.summary.payload_budgeted_routes).toBe(1);
    expect(snapshot.summary.routes_over_payload_budget).toBe(1);
    expect(snapshot.routes[0]).toMatchObject({
      route: '/api/patients/:id/movement-timeline',
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

    expect(snapshot.summary.route_count).toBe(100);
    expect(snapshot.summary.total_requests).toBe(100);
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
    expect(putMetricsMock).toHaveBeenCalledWith(expect.any(Array), { failureMode: 'throw' });
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

  it('shares one in-flight send, preserves new samples, and does not resend drained samples', async () => {
    let resolveSend: (() => void) | undefined;
    putMetricsMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    recordRoutePerformance({
      route: '/api/patients/board',
      method: 'GET',
      status: 200,
      durationMs: 100,
    });

    const firstFlush = flushPerformanceMetricsToCloudWatch({ topRoutes: 5 });
    const concurrentFlush = flushPerformanceMetricsToCloudWatch({ topRoutes: 5 });

    expect(concurrentFlush).toBe(firstFlush);
    await vi.waitFor(() => expect(putMetricsMock).toHaveBeenCalledTimes(1));
    expect(getPerformanceSnapshot().summary.total_requests).toBe(0);

    recordRoutePerformance({
      route: '/api/patients/board',
      method: 'GET',
      status: 200,
      durationMs: 777,
    });
    resolveSend?.();
    await Promise.all([firstFlush, concurrentFlush]);

    expect(getPerformanceSnapshot().routes[0]).toMatchObject({
      route: '/api/patients/board',
      request_count: 1,
      p95_ms: 777,
    });

    putMetricsMock.mockResolvedValue(undefined);
    await flushPerformanceMetricsToCloudWatch({ topRoutes: 5 });
    await flushPerformanceMetricsToCloudWatch({ topRoutes: 5 });

    expect(putMetricsMock).toHaveBeenCalledTimes(2);
    expect(getPerformanceSnapshot().summary.total_requests).toBe(0);
  });

  it('restores failed samples before newly recorded samples, reapplies caps, and retries them', async () => {
    let rejectSend: ((error: Error) => void) | undefined;
    putMetricsMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    for (let index = 0; index < 200; index += 1) {
      recordRoutePerformance({
        route: '/api/patients/board',
        method: 'GET',
        status: 200,
        durationMs: index,
      });
    }

    const failedFlush = flushPerformanceMetricsToCloudWatch({ topRoutes: 5 });
    await vi.waitFor(() => expect(putMetricsMock).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 10; index += 1) {
      recordRoutePerformance({
        route: '/api/patients/board',
        method: 'GET',
        status: 200,
        durationMs: 1_000 + index,
      });
    }
    const providerError = new Error('provider secret must not enter metrics state');
    rejectSend?.(providerError);

    await expect(failedFlush).rejects.toBe(providerError);
    expect(getPerformanceSnapshot().routes[0]).toMatchObject({
      route: '/api/patients/board',
      request_count: 200,
      max_ms: 1_009,
      last_status: 200,
    });
    expect(JSON.stringify(getPerformanceSnapshot())).not.toContain('provider secret');

    putMetricsMock.mockResolvedValue(undefined);
    await flushPerformanceMetricsToCloudWatch({ topRoutes: 5 });

    expect(putMetricsMock).toHaveBeenCalledTimes(2);
    expect(getPerformanceSnapshot().summary.total_requests).toBe(0);
  });

  it('keeps new LRU buckets when failure restoration exceeds the route cap', async () => {
    let rejectSend: ((error: Error) => void) | undefined;
    putMetricsMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    recordRoutePerformance({
      route: '/api/custom/restored-old',
      method: 'GET',
      status: 200,
      durationMs: 900,
    });

    const failedFlush = flushPerformanceMetricsToCloudWatch({ topRoutes: 1 });
    await vi.waitFor(() => expect(putMetricsMock).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 500; index += 1) {
      const suffix = alphabeticRouteSuffix(index);
      recordRoutePerformance({
        route: `/api/custom/new-${suffix}`,
        method: 'GET',
        status: 200,
        durationMs: 10,
      });
    }
    rejectSend?.(new Error('expected provider failure'));

    await expect(failedFlush).rejects.toThrow('expected provider failure');
    const snapshot = getPerformanceSnapshot({ topRoutes: 500 });
    expect(snapshot.summary.route_count).toBe(100);
    expect(snapshot.routes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ route: '/api/custom/restored-old' })]),
    );
    expect(snapshot.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: `/api/custom/new-${alphabeticRouteSuffix(499)}` }),
      ]),
    );
  });

  it('bounds the worst-case payload and drains the full max-cap store by default', async () => {
    vi.stubEnv('APP_ENV', 'environment '.repeat(20));
    vi.stubEnv('DEPLOY_SHA', 'deploy '.repeat(30));
    vi.stubEnv('PHOS_INSTANCE_ID', 'instance '.repeat(30));
    putMetricsMock.mockResolvedValue(undefined);
    for (let index = 0; index < 100; index += 1) {
      const suffix = alphabeticRouteSuffix(index);
      recordRoutePerformance({
        route: `/api/custom/${suffix}-${'long-route-segment-'.repeat(80)}`,
        method: 'EXTREMELY-LONG-METHOD'.repeat(20),
        status: 200,
        durationMs: index + 1,
        queryCount: 1,
      });
    }

    expect(getPerformanceSnapshot({ topRoutes: 500 }).summary.route_count).toBe(100);
    await flushPerformanceMetricsToCloudWatch();
    await flushPerformanceMetricsToCloudWatch();

    expect(putMetricsMock).toHaveBeenCalledTimes(1);
    const [datums, options] = putMetricsMock.mock.calls[0] as [
      Array<{
        MetricName: string;
        Value: number;
        Dimensions: Array<{ Name: string; Value: string }>;
      }>,
      { failureMode: string },
    ];
    expect(datums).toHaveLength(708);
    expect(datums.length).toBeLessThanOrEqual(1000);
    expect(new TextEncoder().encode(JSON.stringify(datums)).byteLength).toBeLessThan(750_000);
    expect(options).toEqual({ failureMode: 'throw' });
    for (const datum of datums) {
      for (const dimension of datum.Dimensions) {
        expect(dimension.Value).toBeTruthy();
        expect(dimension.Value.length).toBeLessThanOrEqual(128);
      }
    }
    expect(datums).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          MetricName: 'OverallP95LatencyMs',
          Value: 95,
          Dimensions: expect.arrayContaining([expect.objectContaining({ Name: 'Environment' })]),
        }),
      ]),
    );
    expect(getPerformanceSnapshot().summary.total_requests).toBe(0);
  });
});
