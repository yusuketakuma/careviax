import type { NextRequest, NextResponse } from 'next/server';

const DEFAULT_TARGET_MS = 500;
const DEFAULT_MAX_SAMPLES_PER_ROUTE = 200;
const DEFAULT_MAX_ROUTES = 500;
const DEFAULT_TOP_ROUTES = 8;
const EXCLUDED_PATHS = new Set(['/api/admin/performance-metrics']);
const KIB = 1024;

type PayloadBudgetDefinition = {
  method: string;
  route: string;
  family: string;
  budget_bytes: number | null;
};

const CRITICAL_ROUTE_PAYLOAD_BUDGETS: PayloadBudgetDefinition[] = [
  {
    method: 'GET',
    route: '/api/dashboard/cockpit/summary',
    family: 'dashboard-summary',
    budget_bytes: 50 * KIB,
  },
  {
    method: 'GET',
    route: '/api/patients/board',
    family: 'patients-board',
    budget_bytes: 300 * KIB,
  },
  {
    method: 'GET',
    route: '/api/patients/:id/overview',
    family: 'patient-detail-initial',
    budget_bytes: 250 * KIB,
  },
  {
    method: 'GET',
    route: '/api/care-reports/today-workspace',
    family: 'reports-today-workspace',
    budget_bytes: 250 * KIB,
  },
  {
    method: 'GET',
    route: '/api/visits/today-preparation',
    family: 'visit-preparation',
    budget_bytes: 200 * KIB,
  },
  {
    method: '*',
    route: '/api/billing*',
    family: 'billing',
    budget_bytes: null,
  },
  {
    method: '*',
    route: '/api/tasks',
    family: 'tasks',
    budget_bytes: null,
  },
  {
    method: '*',
    route: '/api/notifications',
    family: 'notifications',
    budget_bytes: null,
  },
];

const EXACT_ROUTE_PAYLOAD_BUDGETS = new Map(
  CRITICAL_ROUTE_PAYLOAD_BUDGETS.filter((definition) => !definition.route.endsWith('*')).map(
    (definition) => [routeMetricsKey(definition.method, definition.route), definition],
  ),
);

type RoutePerformanceSample = {
  duration_ms: number;
  status: number;
  recorded_at: number;
  payload_bytes: number | null;
};

type RoutePerformanceBucket = {
  route: string;
  method: string;
  samples: RoutePerformanceSample[];
};

type RoutePerformanceStore = {
  started_at: number;
  max_samples_per_route: number;
  max_routes: number;
  routes: Map<string, RoutePerformanceBucket>;
};

export type RoutePerformanceSummary = {
  route: string;
  method: string;
  critical_route: boolean;
  critical_route_family: string | null;
  request_count: number;
  error_count: number;
  slow_count: number;
  slow_rate: number;
  average_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  payload_sample_count: number;
  average_payload_bytes: number | null;
  p95_payload_bytes: number | null;
  max_payload_bytes: number | null;
  payload_budget_bytes: number | null;
  payload_budget_status: PayloadBudgetStatus;
  payload_budget_met: boolean | null;
  payload_budget_over_count: number;
  last_seen_at: string | null;
  last_status: number | null;
  last_payload_bytes: number | null;
  target_met: boolean;
};

export type PerformanceSnapshot = {
  scope: 'current-process';
  target_ms: number;
  collected_since: string;
  summary: {
    route_count: number;
    total_requests: number;
    slow_requests: number;
    error_requests: number;
    slow_request_rate: number;
    overall_p50_ms: number;
    overall_p95_ms: number;
    overall_p95_payload_bytes: number | null;
    critical_routes: number;
    payload_budgeted_routes: number;
    routes_over_payload_budget: number;
    routes_with_unconfigured_payload_budget: number;
    routes_over_target: number;
  };
  routes: RoutePerformanceSummary[];
};

export type PayloadBudgetStatus = 'unconfigured' | 'unmeasured' | 'within_budget' | 'over_budget';

declare global {
  var __phOsRoutePerformanceStore: RoutePerformanceStore | undefined;
}

function getStore(): RoutePerformanceStore {
  if (!globalThis.__phOsRoutePerformanceStore) {
    globalThis.__phOsRoutePerformanceStore = {
      started_at: Date.now(),
      max_samples_per_route: DEFAULT_MAX_SAMPLES_PER_ROUTE,
      max_routes: DEFAULT_MAX_ROUTES,
      routes: new Map(),
    };
  }

  return globalThis.__phOsRoutePerformanceStore;
}

function toPercentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function parsePayloadBytes(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function shouldTrackRoute(route: string): boolean {
  return !EXCLUDED_PATHS.has(route);
}

function routeMetricsKey(method: string, route: string): string {
  return `${method.toUpperCase()} ${route}`;
}

function routeMetricsKeys(method: string, route: string): string[] {
  return [routeMetricsKey(method, route), routeMetricsKey('*', route)];
}

function isDynamicRouteSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{24}$/i.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  if (/^[a-z]{1,16}_[a-z0-9][a-z0-9_-]*$/i.test(segment)) return true;
  if (/^c[a-z0-9]{8,}$/i.test(segment)) return true;
  return segment.length >= 8 && /\d/.test(segment) && /^[a-z0-9_-]+$/i.test(segment);
}

function pathnameOnly(route: string): string {
  try {
    return new URL(route).pathname || '/';
  } catch {
    return route.split(/[?#]/, 1)[0] || '/';
  }
}

function normalizeRoutePath(route: string): string {
  const pathname = pathnameOnly(route);
  const normalizedPathname = pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      return isDynamicRouteSegment(segment) ? ':id' : segment;
    })
    .join('/');

  return normalizedPathname || '/';
}

function resolvePayloadBudget(method: string, route: string): PayloadBudgetDefinition | null {
  for (const key of routeMetricsKeys(method, route)) {
    const exact = EXACT_ROUTE_PAYLOAD_BUDGETS.get(key);
    if (exact) return exact;
  }

  return (
    CRITICAL_ROUTE_PAYLOAD_BUDGETS.find((definition) => {
      if (!definition.route.endsWith('*')) return false;
      if (definition.method !== '*' && definition.method !== method.toUpperCase()) return false;
      return route.startsWith(definition.route.slice(0, -1));
    }) ?? null
  );
}

function payloadBudgetStatus(
  budgetBytes: number | null,
  p95PayloadBytes: number | null,
): PayloadBudgetStatus {
  if (budgetBytes == null) return 'unconfigured';
  if (p95PayloadBytes == null) return 'unmeasured';
  return p95PayloadBytes <= budgetBytes ? 'within_budget' : 'over_budget';
}

export function recordRoutePerformance(args: {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  payloadBytes?: number | null;
  recordedAt?: number;
}): void {
  const store = getStore();
  const route = normalizeRoutePath(args.route);
  if (!shouldTrackRoute(route)) return;

  const key = routeMetricsKey(args.method, route);
  const bucket = store.routes.get(key) ?? {
    route,
    method: args.method.toUpperCase(),
    samples: [],
  };

  bucket.samples.push({
    duration_ms: Math.max(0, Math.round(args.durationMs)),
    status: args.status,
    recorded_at: args.recordedAt ?? Date.now(),
    payload_bytes:
      typeof args.payloadBytes === 'number' && Number.isSafeInteger(args.payloadBytes)
        ? Math.max(0, args.payloadBytes)
        : null,
  });

  if (bucket.samples.length > store.max_samples_per_route) {
    bucket.samples.splice(0, bucket.samples.length - store.max_samples_per_route);
  }

  store.routes.delete(key);
  store.routes.set(key, bucket);

  while (store.routes.size > store.max_routes) {
    const oldestKey = store.routes.keys().next().value;
    if (!oldestKey) break;
    store.routes.delete(oldestKey);
  }
}

export function getPerformanceSnapshot(options?: {
  targetMs?: number;
  topRoutes?: number;
}): PerformanceSnapshot {
  const store = getStore();
  const targetMs = options?.targetMs ?? DEFAULT_TARGET_MS;
  const topRoutes = options?.topRoutes ?? DEFAULT_TOP_ROUTES;

  const routeSummaries: RoutePerformanceSummary[] = [];
  const allDurations: number[] = [];
  const allPayloadBytes: number[] = [];
  let slowRequests = 0;
  let errorRequests = 0;

  for (const bucket of store.routes.values()) {
    const durations = bucket.samples.map((sample) => sample.duration_ms);
    const payloadBytes = bucket.samples
      .map((sample) => sample.payload_bytes)
      .filter((value): value is number => value != null);
    const payloadBudget = resolvePayloadBudget(bucket.method, bucket.route);
    const payloadBudgetBytes = payloadBudget?.budget_bytes ?? null;
    const p95PayloadBytes = payloadBytes.length ? percentile(payloadBytes, 0.95) : null;
    const budgetStatus = payloadBudgetStatus(payloadBudgetBytes, p95PayloadBytes);
    const payloadBudgetOverCount =
      payloadBudgetBytes == null
        ? 0
        : payloadBytes.filter((value) => value > payloadBudgetBytes).length;
    const slowCount = bucket.samples.filter((sample) => sample.duration_ms > targetMs).length;
    const errorCount = bucket.samples.filter((sample) => sample.status >= 500).length;
    const lastSample = bucket.samples[bucket.samples.length - 1];

    allDurations.push(...durations);
    allPayloadBytes.push(...payloadBytes);
    slowRequests += slowCount;
    errorRequests += errorCount;

    routeSummaries.push({
      route: bucket.route,
      method: bucket.method,
      critical_route: payloadBudget != null,
      critical_route_family: payloadBudget?.family ?? null,
      request_count: bucket.samples.length,
      error_count: errorCount,
      slow_count: slowCount,
      slow_rate: toPercentage(slowCount, bucket.samples.length),
      average_ms: average(durations),
      p50_ms: percentile(durations, 0.5),
      p95_ms: percentile(durations, 0.95),
      max_ms: durations.length ? Math.max(...durations) : 0,
      payload_sample_count: payloadBytes.length,
      average_payload_bytes: payloadBytes.length ? average(payloadBytes) : null,
      p95_payload_bytes: p95PayloadBytes,
      max_payload_bytes: payloadBytes.length ? Math.max(...payloadBytes) : null,
      payload_budget_bytes: payloadBudgetBytes ?? null,
      payload_budget_status: budgetStatus,
      payload_budget_met:
        budgetStatus === 'unmeasured' || budgetStatus === 'unconfigured'
          ? null
          : budgetStatus === 'within_budget',
      payload_budget_over_count: payloadBudgetOverCount,
      last_seen_at: lastSample ? new Date(lastSample.recorded_at).toISOString() : null,
      last_status: lastSample?.status ?? null,
      last_payload_bytes: lastSample?.payload_bytes ?? null,
      target_met: percentile(durations, 0.95) <= targetMs,
    });
  }

  routeSummaries.sort((left, right) => {
    if (right.p95_ms !== left.p95_ms) return right.p95_ms - left.p95_ms;
    if (right.slow_rate !== left.slow_rate) return right.slow_rate - left.slow_rate;
    return right.request_count - left.request_count;
  });

  return {
    scope: 'current-process',
    target_ms: targetMs,
    collected_since: new Date(store.started_at).toISOString(),
    summary: {
      route_count: routeSummaries.length,
      total_requests: allDurations.length,
      slow_requests: slowRequests,
      error_requests: errorRequests,
      slow_request_rate: toPercentage(slowRequests, allDurations.length),
      overall_p50_ms: percentile(allDurations, 0.5),
      overall_p95_ms: percentile(allDurations, 0.95),
      overall_p95_payload_bytes: allPayloadBytes.length ? percentile(allPayloadBytes, 0.95) : null,
      critical_routes: routeSummaries.filter((route) => route.critical_route).length,
      payload_budgeted_routes: routeSummaries.filter((route) => route.payload_budget_bytes != null)
        .length,
      routes_over_payload_budget: routeSummaries.filter(
        (route) => route.payload_budget_status === 'over_budget',
      ).length,
      routes_with_unconfigured_payload_budget: routeSummaries.filter(
        (route) => route.critical_route && route.payload_budget_status === 'unconfigured',
      ).length,
      routes_over_target: routeSummaries.filter((route) => !route.target_met).length,
    },
    routes: routeSummaries.slice(0, topRoutes),
  };
}

export async function withRoutePerformance<T extends NextResponse | Response>(
  req: NextRequest,
  handler: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const route =
    req.nextUrl?.pathname ??
    (typeof req.url === 'string'
      ? (() => {
          try {
            return new URL(req.url).pathname;
          } catch {
            return req.url;
          }
        })()
      : '/');
  const method = req.method || 'GET';

  try {
    const response = await handler();
    recordRoutePerformance({
      route,
      method,
      status: response.status,
      durationMs: Date.now() - startedAt,
      payloadBytes: parsePayloadBytes(response.headers.get('content-length')),
    });
    return response;
  } catch (error) {
    recordRoutePerformance({
      route,
      method,
      status: 500,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export function resetPerformanceMetrics(): void {
  globalThis.__phOsRoutePerformanceStore = {
    started_at: Date.now(),
    max_samples_per_route: DEFAULT_MAX_SAMPLES_PER_ROUTE,
    max_routes: DEFAULT_MAX_ROUTES,
    routes: new Map(),
  };
}

/**
 * Flush the current performance snapshot as CloudWatch custom metrics.
 * Emits p50/p95 latency and error rate per route.
 * Call this on a schedule (e.g., every 5 minutes) from a cron API route.
 * Silently no-ops when not in a Node.js server context.
 */
export async function flushPerformanceMetricsToCloudWatch(options?: {
  targetMs?: number;
}): Promise<void> {
  // Dynamic import so the CloudWatch SDK is never bundled into the client
  const { putMetrics, StandardUnit } = await import('@/lib/aws/cloudwatch');
  const snapshot = getPerformanceSnapshot(options);

  if (snapshot.routes.length === 0) return;

  const timestamp = new Date();
  const datums = snapshot.routes.flatMap((route) => [
    {
      MetricName: 'RouteP50LatencyMs',
      Value: route.p50_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: [
        { Name: 'Route', Value: route.route },
        { Name: 'Method', Value: route.method },
      ],
    },
    {
      MetricName: 'RouteP95LatencyMs',
      Value: route.p95_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: [
        { Name: 'Route', Value: route.route },
        { Name: 'Method', Value: route.method },
      ],
    },
    {
      MetricName: 'RouteErrorRate',
      Value: route.error_count > 0 ? (route.error_count / route.request_count) * 100 : 0,
      Unit: StandardUnit.Percent,
      Timestamp: timestamp,
      Dimensions: [
        { Name: 'Route', Value: route.route },
        { Name: 'Method', Value: route.method },
      ],
    },
    {
      MetricName: 'RouteSlowRate',
      Value: route.slow_rate,
      Unit: StandardUnit.Percent,
      Timestamp: timestamp,
      Dimensions: [
        { Name: 'Route', Value: route.route },
        { Name: 'Method', Value: route.method },
      ],
    },
  ]);

  // Overall summary metrics (no Route dimension)
  datums.push(
    {
      MetricName: 'OverallP95LatencyMs',
      Value: snapshot.summary.overall_p95_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: [],
    },
    {
      MetricName: 'SlowRequestRate',
      Value: snapshot.summary.slow_request_rate,
      Unit: StandardUnit.Percent,
      Timestamp: timestamp,
      Dimensions: [],
    },
  );

  await putMetrics(datums);
}
