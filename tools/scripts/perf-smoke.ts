import process from 'node:process';
import { pathToFileURL } from 'node:url';

type Args = {
  baseUrl: string;
  requests: number;
  concurrency: number;
  targetMs: number;
  requestTimeoutMs: number;
  method: string;
  paths: string[];
  headers: Record<string, string>;
};

export type PerfSmokeResult = {
  base_url: string;
  requests: number;
  concurrency: number;
  target_ms: number;
  request_timeout_ms: number;
  method: string;
  paths: string[];
  average_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  error_count: number;
  timeout_count: number;
  target_met: boolean;
};

const DEFAULT_REQUESTS = 40;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TARGET_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUESTS = 10_000;
const MAX_CONCURRENCY = 100;
const MAX_TARGET_MS = 300_000;
const MAX_REQUEST_TIMEOUT_MS = 120_000;

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  const normalized = Math.trunc(parsed);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) return fallback;

  return Math.min(normalized, max);
}

export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): Args {
  const args: Args = {
    baseUrl: env.PERF_BASE_URL ?? 'http://127.0.0.1:3000',
    requests: normalizePositiveInteger(env.PERF_REQUESTS, DEFAULT_REQUESTS, MAX_REQUESTS),
    concurrency: normalizePositiveInteger(
      env.PERF_CONCURRENCY,
      DEFAULT_CONCURRENCY,
      MAX_CONCURRENCY,
    ),
    targetMs: normalizePositiveInteger(env.PERF_TARGET_MS, DEFAULT_TARGET_MS, MAX_TARGET_MS),
    requestTimeoutMs: normalizePositiveInteger(
      env.PERF_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    ),
    method: env.PERF_METHOD ?? 'GET',
    paths: ['/api/health'],
    headers: {},
  };

  let hasExplicitPath = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === '--base-url' && next) args.baseUrl = next;
    if (value === '--requests' && next) {
      args.requests = normalizePositiveInteger(next, DEFAULT_REQUESTS, MAX_REQUESTS);
    }
    if (value === '--concurrency' && next) {
      args.concurrency = normalizePositiveInteger(next, DEFAULT_CONCURRENCY, MAX_CONCURRENCY);
    }
    if (value === '--target-ms' && next) {
      args.targetMs = normalizePositiveInteger(next, DEFAULT_TARGET_MS, MAX_TARGET_MS);
    }
    if (value === '--request-timeout-ms' && next) {
      args.requestTimeoutMs = normalizePositiveInteger(
        next,
        DEFAULT_REQUEST_TIMEOUT_MS,
        MAX_REQUEST_TIMEOUT_MS,
      );
    }
    if (value === '--method' && next) args.method = next.toUpperCase();
    if (value === '--path' && next) {
      if (!hasExplicitPath) {
        args.paths = [];
        hasExplicitPath = true;
      }
      args.paths.push(next);
    }
    if (value === '--header' && next) {
      const separator = next.indexOf(':');
      if (separator > 0) {
        const key = next.slice(0, separator).trim();
        const headerValue = next.slice(separator + 1).trim();
        args.headers[key] = headerValue;
      }
    }
  }

  args.paths = args.paths.filter((item, index, list) => list.indexOf(item) === index);
  return args;
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

function createRequestAbort(timeoutMs: number): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  clear: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('PERF_SMOKE_REQUEST_TIMEOUT'));
  }, timeoutMs);
  maybeUnrefTimeout(timeout);
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    clear: () => clearTimeout(timeout),
  };
}

export async function runPerfSmoke(
  args: Args,
  fetchImpl: typeof fetch = fetch,
): Promise<PerfSmokeResult> {
  const durations: number[] = [];
  let errorCount = 0;
  let timeoutCount = 0;
  let cursor = 0;

  const jobs = Array.from({ length: Math.max(1, args.concurrency) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= args.requests) return;

      const path = args.paths[current % args.paths.length]!;
      const target = new URL(path, args.baseUrl).toString();
      const startedAt = performance.now();
      const requestAbort = createRequestAbort(args.requestTimeoutMs);

      try {
        const response = await fetchImpl(target, {
          method: args.method,
          headers: args.headers,
          signal: requestAbort.signal,
        });
        durations.push(Math.round(performance.now() - startedAt));
        if (!response.ok) {
          errorCount += 1;
        }
      } catch {
        durations.push(Math.round(performance.now() - startedAt));
        errorCount += 1;
        if (requestAbort.didTimeout()) timeoutCount += 1;
      } finally {
        requestAbort.clear();
      }
    }
  });

  await Promise.all(jobs);

  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const max = durations.length > 0 ? Math.max(...durations) : 0;
  const average =
    durations.length > 0
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0;

  return {
    base_url: args.baseUrl,
    requests: args.requests,
    concurrency: args.concurrency,
    target_ms: args.targetMs,
    request_timeout_ms: args.requestTimeoutMs,
    method: args.method,
    paths: args.paths,
    average_ms: average,
    p50_ms: p50,
    p95_ms: p95,
    max_ms: max,
    error_count: errorCount,
    timeout_count: timeoutCount,
    target_met: p95 <= args.targetMs && errorCount === 0,
  };
}

async function main() {
  const result = await runPerfSmoke(parseArgs(process.argv.slice(2)));

  console.log(JSON.stringify(result, null, 2));

  if (!result.target_met) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
