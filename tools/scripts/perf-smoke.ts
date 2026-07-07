import process from 'node:process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  CRITICAL_ROUTE_PAYLOAD_BUDGETS,
  payloadBudgetStatus,
  resolveRoutePayloadBudget,
  type PayloadBudgetDefinition,
  type PayloadBudgetStatus,
} from '../../src/lib/utils/route-payload-budgets';
import { maybeUnrefTimeout } from '../shared/abort-timeout';

type Args = {
  baseUrl: string;
  requests: number;
  concurrency: number;
  targetMs: number;
  p99TargetMs: number;
  requestTimeoutMs: number;
  method: string;
  paths: string[];
  headers: Record<string, string>;
  body?: string;
  payloadBudgetMatrix: boolean;
};

export type PerfSmokeResult = {
  base_url: string;
  requests: number;
  concurrency: number;
  target_ms: number;
  p99_target_ms: number;
  request_timeout_ms: number;
  method: string;
  paths: string[];
  body_bytes: number;
  response_payload_sample_count: number;
  response_payload_content_length_sample_count: number;
  response_payload_body_fallback_sample_count: number;
  response_payload_measurement_status: ResponsePayloadMeasurementStatus;
  average_response_payload_bytes: number | null;
  p50_response_payload_bytes: number | null;
  p95_response_payload_bytes: number | null;
  max_response_payload_bytes: number | null;
  response_payload_route_family: string | null;
  response_payload_budget_bytes: number | null;
  response_payload_budget_status: PayloadBudgetStatus;
  response_payload_budget_met: boolean | null;
  response_payload_budget_over_count: number;
  average_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  error_count: number;
  timeout_count: number;
  p95_target_met: boolean;
  p99_target_met: boolean;
  target_met: boolean;
};

type ResponsePayloadMeasurementSource = 'content_length' | 'body_fallback';
export type ResponsePayloadMeasurementStatus =
  | 'content_length'
  | 'body_fallback'
  | 'mixed'
  | 'none';

export type PerfSmokeMatrixEntry = PerfSmokeResult & {
  path: string;
  budget_route: string | null;
  runtime_payload_measurement_required: boolean;
  runtime_payload_measurement_met: boolean | null;
};

export type PerfSmokeMatrixWarning = {
  code: 'PAYLOAD_UNMEASURED' | 'PAYLOAD_OVER_BUDGET' | 'REQUEST_ERROR' | 'LATENCY_TARGET_MISSED';
  path: string;
  family: string | null;
  budget_route: string | null;
};

export type PerfSmokeMatrixResult = {
  mode: 'payload_budget_matrix';
  base_url: string;
  requests_per_path: number;
  concurrency: number;
  target_ms: number;
  p99_target_ms: number;
  request_timeout_ms: number;
  method: string;
  paths: string[];
  summary: {
    route_count: number;
    configured_payload_budget_count: number;
    measured_by_content_length_count: number;
    runtime_unmeasured_route_count: number;
    over_budget_route_count: number;
    error_route_count: number;
    latency_failed_route_count: number;
  };
  warnings: PerfSmokeMatrixWarning[];
  entries: PerfSmokeMatrixEntry[];
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
    p99TargetMs: normalizePositiveInteger(
      env.PERF_P99_TARGET_MS,
      DEFAULT_TARGET_MS * 2,
      MAX_TARGET_MS,
    ),
    requestTimeoutMs: normalizePositiveInteger(
      env.PERF_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      MAX_REQUEST_TIMEOUT_MS,
    ),
    method: env.PERF_METHOD ?? 'GET',
    paths: ['/api/health'],
    headers: {},
    ...(env.PERF_BODY ? { body: env.PERF_BODY } : {}),
    payloadBudgetMatrix: env.PERF_PAYLOAD_BUDGET_MATRIX === '1',
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
    if (value === '--p99-target-ms' && next) {
      args.p99TargetMs = normalizePositiveInteger(next, DEFAULT_TARGET_MS * 2, MAX_TARGET_MS);
    }
    if (value === '--request-timeout-ms' && next) {
      args.requestTimeoutMs = normalizePositiveInteger(
        next,
        DEFAULT_REQUEST_TIMEOUT_MS,
        MAX_REQUEST_TIMEOUT_MS,
      );
    }
    if (value === '--method' && next) args.method = next.toUpperCase();
    if (value === '--body' && next) args.body = next;
    if (value === '--body-file' && next) args.body = readFileSync(next, 'utf8');
    if (value === '--payload-budget-matrix') {
      args.payloadBudgetMatrix = true;
    }
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

  if (args.payloadBudgetMatrix && !hasExplicitPath) {
    args.paths = buildDefaultPayloadBudgetMatrixPaths(env);
  }

  args.paths = args.paths.filter((item, index, list) => list.indexOf(item) === index);
  return args;
}

function buildDefaultPayloadBudgetMatrixPaths(env: Record<string, string | undefined>): string[] {
  return CRITICAL_ROUTE_PAYLOAD_BUDGETS.filter(isMatrixBudgetDefinition).map((definition) =>
    materializeBudgetRoute(definition.route, env),
  );
}

function isMatrixBudgetDefinition(definition: PayloadBudgetDefinition): boolean {
  return (
    definition.method === 'GET' &&
    definition.budget_bytes != null &&
    !definition.route.endsWith('*')
  );
}

function materializeBudgetRoute(
  route: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const patientId = env.PERF_PATIENT_ID ?? 'patient_1';
  return route.replaceAll(':id', patientId);
}

function safeOutputPath(path: string, baseUrl: string): string {
  try {
    return new URL(path, baseUrl).pathname || '/';
  } catch {
    return path.split(/[?#]/, 1)[0] || '/';
  }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

function buildRequestInit(args: Args, signal: AbortSignal): RequestInit {
  const headers = { ...args.headers };
  const body = args.method === 'GET' || args.method === 'HEAD' ? undefined : args.body;
  if (body !== undefined && !hasHeader(headers, 'content-type')) {
    headers['content-type'] = 'application/json';
  }

  return {
    method: args.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    signal,
  };
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function measureResponsePayloadBytes(response: Response): Promise<{
  bytes: number;
  source: ResponsePayloadMeasurementSource;
}> {
  const contentLength = parseContentLength(response.headers.get('content-length'));
  if (contentLength != null) return { bytes: contentLength, source: 'content_length' };

  return { bytes: (await response.arrayBuffer()).byteLength, source: 'body_fallback' };
}

function resolveResponsePayloadBudget(args: Args): {
  family: string | null;
  budgetBytes: number | null;
} {
  const definitions = args.paths.map((path) => resolveRoutePayloadBudget(args.method, path));
  const criticalDefinitions = definitions.filter((definition) => definition != null);
  if (criticalDefinitions.length === 0) return { family: null, budgetBytes: null };

  const families = new Set(criticalDefinitions.map((definition) => definition.family));
  const configuredBudgets = criticalDefinitions
    .map((definition) => definition.budget_bytes)
    .filter((budgetBytes): budgetBytes is number => budgetBytes != null);

  if (configuredBudgets.length !== args.paths.length) {
    return { family: families.size === 1 ? ([...families][0] ?? null) : null, budgetBytes: null };
  }

  const uniqueBudgets = new Set(configuredBudgets);
  return {
    family: families.size === 1 ? ([...families][0] ?? null) : null,
    budgetBytes: uniqueBudgets.size === 1 ? ([...uniqueBudgets][0] ?? null) : null,
  };
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

export function createRequestAbort(timeoutMs: number): {
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

function summarizePayloadMeasurement(
  contentLengthCount: number,
  bodyFallbackCount: number,
): ResponsePayloadMeasurementStatus {
  if (contentLengthCount === 0 && bodyFallbackCount === 0) return 'none';
  if (contentLengthCount > 0 && bodyFallbackCount === 0) return 'content_length';
  if (contentLengthCount === 0 && bodyFallbackCount > 0) return 'body_fallback';
  return 'mixed';
}

export async function runPerfSmoke(
  args: Args,
  fetchImpl: typeof fetch = fetch,
): Promise<PerfSmokeResult> {
  const durations: number[] = [];
  const responsePayloadBytes: number[] = [];
  let responsePayloadContentLengthCount = 0;
  let responsePayloadBodyFallbackCount = 0;
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
          ...buildRequestInit(args, requestAbort.signal),
        });
        const responsePayload = await measureResponsePayloadBytes(response);
        responsePayloadBytes.push(responsePayload.bytes);
        if (responsePayload.source === 'content_length') {
          responsePayloadContentLengthCount += 1;
        } else {
          responsePayloadBodyFallbackCount += 1;
        }
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
  const p99 = percentile(durations, 0.99);
  const max = durations.length > 0 ? Math.max(...durations) : 0;
  const p50ResponsePayload =
    responsePayloadBytes.length > 0 ? percentile(responsePayloadBytes, 0.5) : null;
  const p95ResponsePayload =
    responsePayloadBytes.length > 0 ? percentile(responsePayloadBytes, 0.95) : null;
  const maxResponsePayload =
    responsePayloadBytes.length > 0 ? Math.max(...responsePayloadBytes) : null;
  const averageResponsePayload =
    responsePayloadBytes.length > 0
      ? Math.round(
          responsePayloadBytes.reduce((sum, value) => sum + value, 0) / responsePayloadBytes.length,
        )
      : null;
  const responsePayloadBudget = resolveResponsePayloadBudget(args);
  const responsePayloadBudgetBytes = responsePayloadBudget.budgetBytes;
  const responsePayloadBudgetStatus = payloadBudgetStatus(
    responsePayloadBudgetBytes,
    p95ResponsePayload,
  );
  const responsePayloadBudgetMet =
    responsePayloadBudgetStatus === 'within_budget'
      ? true
      : responsePayloadBudgetStatus === 'over_budget'
        ? false
        : null;
  const responsePayloadBudgetOverCount =
    responsePayloadBudgetBytes == null
      ? 0
      : responsePayloadBytes.filter((value) => value > responsePayloadBudgetBytes).length;
  const average =
    durations.length > 0
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0;
  const p95TargetMet = p95 <= args.targetMs;
  const p99TargetMet = p99 <= args.p99TargetMs;

  return {
    base_url: args.baseUrl,
    requests: args.requests,
    concurrency: args.concurrency,
    target_ms: args.targetMs,
    p99_target_ms: args.p99TargetMs,
    request_timeout_ms: args.requestTimeoutMs,
    method: args.method,
    paths: args.paths.map((path) => safeOutputPath(path, args.baseUrl)),
    body_bytes: args.body ? Buffer.byteLength(args.body) : 0,
    response_payload_sample_count: responsePayloadBytes.length,
    response_payload_content_length_sample_count: responsePayloadContentLengthCount,
    response_payload_body_fallback_sample_count: responsePayloadBodyFallbackCount,
    response_payload_measurement_status: summarizePayloadMeasurement(
      responsePayloadContentLengthCount,
      responsePayloadBodyFallbackCount,
    ),
    average_response_payload_bytes: averageResponsePayload,
    p50_response_payload_bytes: p50ResponsePayload,
    p95_response_payload_bytes: p95ResponsePayload,
    max_response_payload_bytes: maxResponsePayload,
    response_payload_route_family: responsePayloadBudget.family,
    response_payload_budget_bytes: responsePayloadBudgetBytes,
    response_payload_budget_status: responsePayloadBudgetStatus,
    response_payload_budget_met: responsePayloadBudgetMet,
    response_payload_budget_over_count: responsePayloadBudgetOverCount,
    average_ms: average,
    p50_ms: p50,
    p95_ms: p95,
    p99_ms: p99,
    max_ms: max,
    error_count: errorCount,
    timeout_count: timeoutCount,
    p95_target_met: p95TargetMet,
    p99_target_met: p99TargetMet,
    target_met:
      p95TargetMet && p99TargetMet && errorCount === 0 && responsePayloadBudgetMet !== false,
  };
}

export async function runPerfSmokeMatrix(
  args: Args,
  fetchImpl: typeof fetch = fetch,
): Promise<PerfSmokeMatrixResult> {
  const entries: PerfSmokeMatrixEntry[] = [];
  const warnings: PerfSmokeMatrixWarning[] = [];

  for (const path of args.paths) {
    const entryArgs: Args = { ...args, paths: [path], payloadBudgetMatrix: false };
    const result = await runPerfSmoke(entryArgs, fetchImpl);
    const budget = resolveRoutePayloadBudget(args.method, path);
    const outputPath = safeOutputPath(path, args.baseUrl);
    const runtimePayloadMeasurementRequired = budget?.budget_bytes != null;
    const runtimePayloadMeasurementMet =
      runtimePayloadMeasurementRequired && result.response_payload_sample_count > 0
        ? result.response_payload_body_fallback_sample_count === 0
        : runtimePayloadMeasurementRequired
          ? false
          : null;

    const entry: PerfSmokeMatrixEntry = {
      ...result,
      paths: [outputPath],
      path: outputPath,
      budget_route: budget?.route ?? null,
      runtime_payload_measurement_required: runtimePayloadMeasurementRequired,
      runtime_payload_measurement_met: runtimePayloadMeasurementMet,
      target_met: result.target_met && runtimePayloadMeasurementMet !== false,
    };
    entries.push(entry);

    if (entry.runtime_payload_measurement_met === false) {
      warnings.push({
        code: 'PAYLOAD_UNMEASURED',
        path: outputPath,
        family: entry.response_payload_route_family,
        budget_route: entry.budget_route,
      });
    }
    if (entry.response_payload_budget_status === 'over_budget') {
      warnings.push({
        code: 'PAYLOAD_OVER_BUDGET',
        path: outputPath,
        family: entry.response_payload_route_family,
        budget_route: entry.budget_route,
      });
    }
    if (entry.error_count > 0 || entry.timeout_count > 0) {
      warnings.push({
        code: 'REQUEST_ERROR',
        path: outputPath,
        family: entry.response_payload_route_family,
        budget_route: entry.budget_route,
      });
    }
    if (!entry.p95_target_met || !entry.p99_target_met) {
      warnings.push({
        code: 'LATENCY_TARGET_MISSED',
        path: outputPath,
        family: entry.response_payload_route_family,
        budget_route: entry.budget_route,
      });
    }
  }

  const targetMet = entries.every((entry) => entry.target_met);
  return {
    mode: 'payload_budget_matrix',
    base_url: args.baseUrl,
    requests_per_path: args.requests,
    concurrency: args.concurrency,
    target_ms: args.targetMs,
    p99_target_ms: args.p99TargetMs,
    request_timeout_ms: args.requestTimeoutMs,
    method: args.method,
    paths: args.paths.map((path) => safeOutputPath(path, args.baseUrl)),
    summary: {
      route_count: entries.length,
      configured_payload_budget_count: entries.filter(
        (entry) => entry.response_payload_budget_bytes != null,
      ).length,
      measured_by_content_length_count: entries.filter(
        (entry) => entry.runtime_payload_measurement_met === true,
      ).length,
      runtime_unmeasured_route_count: entries.filter(
        (entry) => entry.runtime_payload_measurement_met === false,
      ).length,
      over_budget_route_count: entries.filter(
        (entry) => entry.response_payload_budget_status === 'over_budget',
      ).length,
      error_route_count: entries.filter((entry) => entry.error_count > 0).length,
      latency_failed_route_count: entries.filter(
        (entry) => !entry.p95_target_met || !entry.p99_target_met,
      ).length,
    },
    warnings,
    entries,
    target_met: targetMet,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = args.payloadBudgetMatrix
    ? await runPerfSmokeMatrix(args)
    : await runPerfSmoke(args);

  console.log(JSON.stringify(result, null, 2));

  if (!result.target_met) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
