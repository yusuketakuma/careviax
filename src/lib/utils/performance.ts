import type { NextRequest, NextResponse } from 'next/server';
import {
  normalizeRoutePath,
  payloadBudgetStatus,
  resolveRoutePayloadBudget,
  routeMetricsKey,
  type PayloadBudgetStatus,
} from './route-payload-budgets';

const DEFAULT_TARGET_MS = 500;
const DEFAULT_MAX_SAMPLES_PER_ROUTE = 200;
const DEFAULT_MAX_ROUTES = 500;
const DEFAULT_TOP_ROUTES = 8;
const EXCLUDED_PATHS = new Set(['/api/admin/performance-metrics']);
export const ROUTE_QUERY_COUNT_HEADER = 'x-phos-query-count';

type RoutePerformanceSample = {
  duration_ms: number;
  status: number;
  recorded_at: number;
  payload_bytes: number | null;
  query_count: number | null;
  org_scope: RouteOrgScope;
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
  org_scope: RouteOrgScopeSummary;
  critical_route: boolean;
  critical_route_family: string | null;
  request_count: number;
  error_count: number;
  slow_count: number;
  slow_rate: number;
  average_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  payload_sample_count: number;
  average_payload_bytes: number | null;
  p95_payload_bytes: number | null;
  max_payload_bytes: number | null;
  query_count_sample_count: number;
  average_query_count: number | null;
  p95_query_count: number | null;
  max_query_count: number | null;
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
    overall_p99_ms: number;
    overall_p95_payload_bytes: number | null;
    overall_p95_query_count: number | null;
    critical_routes: number;
    payload_budgeted_routes: number;
    routes_over_payload_budget: number;
    routes_with_unconfigured_payload_budget: number;
    routes_over_target: number;
  };
  routes: RoutePerformanceSummary[];
};

type RouteOrgScope = 'with_org' | 'without_org';
type RouteOrgScopeSummary = RouteOrgScope | 'mixed';

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

function parseNonNegativeInteger(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function summarizeOrgScope(samples: RoutePerformanceSample[]): RouteOrgScopeSummary {
  const scopes = new Set(samples.map((sample) => sample.org_scope));
  if (scopes.size > 1) return 'mixed';
  return scopes.has('with_org') ? 'with_org' : 'without_org';
}

function sanitizeDimensionValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^\w.:/@-]/g, '_').slice(0, 128) || fallback;
}

function resolveRuntimeMetricDimensions(): Array<{ Name: string; Value: string }> {
  return [
    {
      Name: 'Environment',
      Value: sanitizeDimensionValue(
        process.env.APP_ENV ?? process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV,
        'unknown',
      ),
    },
    {
      Name: 'DeploySha',
      Value: sanitizeDimensionValue(
        process.env.DEPLOY_SHA ??
          process.env.GITHUB_SHA ??
          process.env.VERCEL_GIT_COMMIT_SHA ??
          process.env.COMMIT_SHA,
        'unknown',
      ),
    },
    {
      Name: 'InstanceId',
      Value: sanitizeDimensionValue(
        process.env.PHOS_INSTANCE_ID ??
          process.env.ECS_CONTAINER_METADATA_URI_V4 ??
          process.env.HOSTNAME,
        'unknown',
      ),
    },
  ];
}

function shouldTrackRoute(route: string): boolean {
  return !EXCLUDED_PATHS.has(route);
}

export function recordRoutePerformance(args: {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  payloadBytes?: number | null;
  queryCount?: number | null;
  orgScopePresent?: boolean;
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
    query_count:
      typeof args.queryCount === 'number' && Number.isSafeInteger(args.queryCount)
        ? Math.max(0, args.queryCount)
        : null,
    org_scope: args.orgScopePresent ? 'with_org' : 'without_org',
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
  const allQueryCounts: number[] = [];
  let slowRequests = 0;
  let errorRequests = 0;

  for (const bucket of store.routes.values()) {
    const durations = bucket.samples.map((sample) => sample.duration_ms);
    const payloadBytes = bucket.samples
      .map((sample) => sample.payload_bytes)
      .filter((value): value is number => value != null);
    const queryCounts = bucket.samples
      .map((sample) => sample.query_count)
      .filter((value): value is number => value != null);
    const payloadBudget = resolveRoutePayloadBudget(bucket.method, bucket.route);
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
    allQueryCounts.push(...queryCounts);
    slowRequests += slowCount;
    errorRequests += errorCount;

    routeSummaries.push({
      route: bucket.route,
      method: bucket.method,
      org_scope: summarizeOrgScope(bucket.samples),
      critical_route: payloadBudget != null,
      critical_route_family: payloadBudget?.family ?? null,
      request_count: bucket.samples.length,
      error_count: errorCount,
      slow_count: slowCount,
      slow_rate: toPercentage(slowCount, bucket.samples.length),
      average_ms: average(durations),
      p50_ms: percentile(durations, 0.5),
      p95_ms: percentile(durations, 0.95),
      p99_ms: percentile(durations, 0.99),
      max_ms: durations.length ? Math.max(...durations) : 0,
      payload_sample_count: payloadBytes.length,
      average_payload_bytes: payloadBytes.length ? average(payloadBytes) : null,
      p95_payload_bytes: p95PayloadBytes,
      max_payload_bytes: payloadBytes.length ? Math.max(...payloadBytes) : null,
      query_count_sample_count: queryCounts.length,
      average_query_count: queryCounts.length ? average(queryCounts) : null,
      p95_query_count: queryCounts.length ? percentile(queryCounts, 0.95) : null,
      max_query_count: queryCounts.length ? Math.max(...queryCounts) : null,
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
      overall_p99_ms: percentile(allDurations, 0.99),
      overall_p95_payload_bytes: allPayloadBytes.length ? percentile(allPayloadBytes, 0.95) : null,
      overall_p95_query_count: allQueryCounts.length ? percentile(allQueryCounts, 0.95) : null,
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
      queryCount: parseNonNegativeInteger(response.headers.get(ROUTE_QUERY_COUNT_HEADER)),
      orgScopePresent: Boolean(req.headers?.get('x-org-id')),
    });
    response.headers.delete(ROUTE_QUERY_COUNT_HEADER);
    return response;
  } catch (error) {
    recordRoutePerformance({
      route,
      method,
      status: 500,
      durationMs: Date.now() - startedAt,
      orgScopePresent: Boolean(req.headers?.get('x-org-id')),
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
 * Emits p50/p95/p99 latency and error rate per route.
 * Call this on a schedule (e.g., every 5 minutes) from a cron API route.
 * Silently no-ops when not in a Node.js server context.
 */
export async function flushPerformanceMetricsToCloudWatch(options?: {
  targetMs?: number;
  topRoutes?: number;
}): Promise<void> {
  // Dynamic import so the CloudWatch SDK is never bundled into the client
  const { putMetrics, StandardUnit } = await import('@/lib/aws/cloudwatch');
  const snapshot = getPerformanceSnapshot(options);

  if (snapshot.routes.length === 0) return;

  const timestamp = new Date();
  const runtimeDimensions = resolveRuntimeMetricDimensions();
  const routeDimensions = (route: RoutePerformanceSummary) => [
    { Name: 'Route', Value: route.route },
    { Name: 'Method', Value: route.method },
    { Name: 'OrgScope', Value: route.org_scope },
    ...runtimeDimensions,
  ];
  const summaryDimensions = [{ Name: 'OrgScope', Value: 'aggregate' }, ...runtimeDimensions];
  const stableSummaryDimensions = [{ Name: 'OrgScope', Value: 'aggregate' }];
  const datums = snapshot.routes.flatMap((route) => [
    {
      MetricName: 'RouteP50LatencyMs',
      Value: route.p50_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: routeDimensions(route),
    },
    {
      MetricName: 'RouteP95LatencyMs',
      Value: route.p95_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: routeDimensions(route),
    },
    {
      MetricName: 'RouteP99LatencyMs',
      Value: route.p99_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: routeDimensions(route),
    },
    {
      MetricName: 'RouteErrorRate',
      Value: route.error_count > 0 ? (route.error_count / route.request_count) * 100 : 0,
      Unit: StandardUnit.Percent,
      Timestamp: timestamp,
      Dimensions: routeDimensions(route),
    },
    {
      MetricName: 'RouteSlowRate',
      Value: route.slow_rate,
      Unit: StandardUnit.Percent,
      Timestamp: timestamp,
      Dimensions: routeDimensions(route),
    },
    {
      MetricName: 'RoutePayloadBudgetOverCount',
      Value: route.payload_budget_over_count,
      Unit: StandardUnit.Count,
      Timestamp: timestamp,
      Dimensions: routeDimensions(route),
    },
    ...(route.p95_query_count == null
      ? []
      : [
          {
            MetricName: 'RouteP95QueryCount',
            Value: route.p95_query_count,
            Unit: StandardUnit.Count,
            Timestamp: timestamp,
            Dimensions: routeDimensions(route),
          },
        ]),
  ]);

  // Overall summary metrics (no Route dimension)
  datums.push(
    {
      MetricName: 'OverallP95LatencyMs',
      Value: snapshot.summary.overall_p95_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: summaryDimensions,
    },
    {
      MetricName: 'OverallP99LatencyMs',
      Value: snapshot.summary.overall_p99_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: summaryDimensions,
    },
    {
      MetricName: 'OverallP99LatencyMs',
      Value: snapshot.summary.overall_p99_ms,
      Unit: StandardUnit.Milliseconds,
      Timestamp: timestamp,
      Dimensions: stableSummaryDimensions,
    },
    {
      MetricName: 'SlowRequestRate',
      Value: snapshot.summary.slow_request_rate,
      Unit: StandardUnit.Percent,
      Timestamp: timestamp,
      Dimensions: summaryDimensions,
    },
    {
      MetricName: 'PayloadBudgetOverRoutes',
      Value: snapshot.summary.routes_over_payload_budget,
      Unit: StandardUnit.Count,
      Timestamp: timestamp,
      Dimensions: summaryDimensions,
    },
    {
      MetricName: 'PayloadBudgetOverRoutes',
      Value: snapshot.summary.routes_over_payload_budget,
      Unit: StandardUnit.Count,
      Timestamp: timestamp,
      Dimensions: stableSummaryDimensions,
    },
    ...(snapshot.summary.overall_p95_query_count == null
      ? []
      : [
          {
            MetricName: 'OverallP95QueryCount',
            Value: snapshot.summary.overall_p95_query_count,
            Unit: StandardUnit.Count,
            Timestamp: timestamp,
            Dimensions: summaryDimensions,
          },
          {
            MetricName: 'OverallP95QueryCount',
            Value: snapshot.summary.overall_p95_query_count,
            Unit: StandardUnit.Count,
            Timestamp: timestamp,
            Dimensions: stableSummaryDimensions,
          },
        ]),
  );

  await putMetrics(datums);
}
