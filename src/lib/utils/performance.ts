import type { NextRequest, NextResponse } from 'next/server';

const DEFAULT_TARGET_MS = 500;
const DEFAULT_MAX_SAMPLES_PER_ROUTE = 200;
const DEFAULT_TOP_ROUTES = 8;
const EXCLUDED_PATHS = new Set(['/api/admin/performance-metrics']);

type RoutePerformanceSample = {
  duration_ms: number;
  status: number;
  recorded_at: number;
};

type RoutePerformanceBucket = {
  route: string;
  method: string;
  samples: RoutePerformanceSample[];
};

type RoutePerformanceStore = {
  started_at: number;
  max_samples_per_route: number;
  routes: Map<string, RoutePerformanceBucket>;
};

export type RoutePerformanceSummary = {
  route: string;
  method: string;
  request_count: number;
  error_count: number;
  slow_count: number;
  slow_rate: number;
  average_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  last_seen_at: string | null;
  last_status: number | null;
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
    routes_over_target: number;
  };
  routes: RoutePerformanceSummary[];
};

declare global {
  var __phOsRoutePerformanceStore: RoutePerformanceStore | undefined;
}

function getStore(): RoutePerformanceStore {
  if (!globalThis.__phOsRoutePerformanceStore) {
    globalThis.__phOsRoutePerformanceStore = {
      started_at: Date.now(),
      max_samples_per_route: DEFAULT_MAX_SAMPLES_PER_ROUTE,
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

function shouldTrackRoute(route: string): boolean {
  return !EXCLUDED_PATHS.has(route);
}

export function recordRoutePerformance(args: {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  recordedAt?: number;
}): void {
  if (!shouldTrackRoute(args.route)) return;

  const store = getStore();
  const key = `${args.method.toUpperCase()} ${args.route}`;
  const bucket = store.routes.get(key) ?? {
    route: args.route,
    method: args.method.toUpperCase(),
    samples: [],
  };

  bucket.samples.push({
    duration_ms: Math.max(0, Math.round(args.durationMs)),
    status: args.status,
    recorded_at: args.recordedAt ?? Date.now(),
  });

  if (bucket.samples.length > store.max_samples_per_route) {
    bucket.samples.splice(0, bucket.samples.length - store.max_samples_per_route);
  }

  store.routes.set(key, bucket);
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
  let slowRequests = 0;
  let errorRequests = 0;

  for (const bucket of store.routes.values()) {
    const durations = bucket.samples.map((sample) => sample.duration_ms);
    const slowCount = bucket.samples.filter((sample) => sample.duration_ms > targetMs).length;
    const errorCount = bucket.samples.filter((sample) => sample.status >= 500).length;
    const lastSample = bucket.samples[bucket.samples.length - 1];

    allDurations.push(...durations);
    slowRequests += slowCount;
    errorRequests += errorCount;

    routeSummaries.push({
      route: bucket.route,
      method: bucket.method,
      request_count: bucket.samples.length,
      error_count: errorCount,
      slow_count: slowCount,
      slow_rate: toPercentage(slowCount, bucket.samples.length),
      average_ms: average(durations),
      p50_ms: percentile(durations, 0.5),
      p95_ms: percentile(durations, 0.95),
      max_ms: durations.length ? Math.max(...durations) : 0,
      last_seen_at: lastSample ? new Date(lastSample.recorded_at).toISOString() : null,
      last_status: lastSample?.status ?? null,
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
      routes_over_target: routeSummaries.filter((route) => !route.target_met).length,
    },
    routes: routeSummaries.slice(0, topRoutes),
  };
}

export async function withRoutePerformance<T extends NextResponse | Response>(
  req: NextRequest,
  handler: () => Promise<T>
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
    }
  );

  await putMetrics(datums);
}
