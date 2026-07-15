import { readJsonObject } from '@/lib/db/json';
import {
  HARD_HTTP_BODY_DEADLINE_MS,
  readBoundedBody,
  resolveBoundedBodyReadPolicy,
  type BoundedBodyReadFailureReason,
  type BoundedBodyReadPolicy,
} from '@/lib/http/bounded-body';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import { createFetchTimeout } from '@/server/services/fetch-timeout';

export class HttpAdapterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly causeDetail?: unknown,
  ) {
    super(message);
    this.name = 'HttpAdapterError';
  }
}

type FetchJsonOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

const DEFAULT_HTTP_ADAPTER_TIMEOUT_MS = 10_000;

function resolveHttpAdapterTimeoutMs(timeoutMs?: number): number {
  return normalizePositiveTimeoutMs(timeoutMs ?? process.env.HTTP_ADAPTER_TIMEOUT_MS, {
    fallbackMs: DEFAULT_HTTP_ADAPTER_TIMEOUT_MS,
  });
}

function responseBodyReadError(
  status: number,
  reason: BoundedBodyReadFailureReason,
  policy: BoundedBodyReadPolicy,
) {
  if (reason === 'too_large') {
    return new HttpAdapterError(
      `Response body exceeds the configured byte limit (HTTP ${status})`,
      status,
      {
        reason: 'response_body_too_large',
        upstream_status: status,
        max_bytes: policy.maxBytes,
      },
    );
  }

  if (reason === 'timeout' || reason === 'aborted') {
    return new HttpAdapterError('Response body timed out', undefined, {
      reason: 'response_body_timeout',
      deadline_ms: policy.deadlineMs,
    });
  }

  return new HttpAdapterError('Response body is unreadable', undefined, {
    reason: 'response_body_unreadable',
  });
}

export async function fetchJson(
  url: string,
  options: FetchJsonOptions = {},
): Promise<{ status: number; data: unknown | null }> {
  const timeoutMs = resolveHttpAdapterTimeoutMs(options.timeoutMs);
  const responseBodyPolicy = resolveBoundedBodyReadPolicy({
    maxBytes: options.maxResponseBytes,
    deadlineMs: Math.min(timeoutMs, HARD_HTTP_BODY_DEADLINE_MS),
  });
  const abort = createFetchTimeout(timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: abort.signal,
    });

    if (
      response.body === null ||
      response.status === 204 ||
      response.status === 205 ||
      response.status === 304
    ) {
      return { status: response.status, data: null };
    }

    const bodyResult = await readBoundedBody(response, {
      maxBytes: responseBodyPolicy.maxBytes,
      deadlineMs: responseBodyPolicy.deadlineMs,
      signal: abort.signal,
    });
    if (!bodyResult.ok) {
      throw responseBodyReadError(response.status, bodyResult.reason, responseBodyPolicy);
    }
    if (bodyResult.bytes.byteLength === 0) {
      return { status: response.status, data: null };
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bodyResult.bytes);
    } catch {
      throw new HttpAdapterError(
        `Response body is not valid UTF-8 (HTTP ${response.status})`,
        response.status,
        {
          reason: 'response_body_invalid_utf8',
          upstream_status: response.status,
        },
      );
    }

    try {
      return { status: response.status, data: JSON.parse(text) };
    } catch {
      throw new HttpAdapterError(
        `Response body is not valid JSON (HTTP ${response.status})`,
        response.status,
        {
          reason: 'response_body_invalid_json',
          upstream_status: response.status,
        },
      );
    }
  } finally {
    abort.clear();
  }
}

export function buildBearerHeaders(token?: string, apiKey?: string) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
}

export function unwrapDataEnvelope(payload: unknown): unknown | null {
  if (payload === null || payload === undefined) return null;
  const object = readJsonObject(payload);
  if (object && 'data' in object) {
    return object.data ?? null;
  }
  return payload;
}
