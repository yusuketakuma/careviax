import { readJsonObject } from '@/lib/db/json';
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
};

const DEFAULT_HTTP_ADAPTER_TIMEOUT_MS = 10_000;

function resolveHttpAdapterTimeoutMs(timeoutMs?: number): number {
  return normalizePositiveTimeoutMs(timeoutMs ?? process.env.HTTP_ADAPTER_TIMEOUT_MS, {
    fallbackMs: DEFAULT_HTTP_ADAPTER_TIMEOUT_MS,
  });
}

export async function fetchJson(
  url: string,
  options: FetchJsonOptions = {},
): Promise<{ status: number; data: unknown | null }> {
  const abort = createFetchTimeout(resolveHttpAdapterTimeoutMs(options.timeoutMs));
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: abort.signal,
    });
  } finally {
    abort.clear();
  }

  if (response.status === 204) {
    return { status: response.status, data: null };
  }

  const text = await response.text();
  let data: unknown | null = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new HttpAdapterError(
        `Response body is not valid JSON (HTTP ${response.status})`,
        response.status,
        err,
      );
    }
  }
  return { status: response.status, data };
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
