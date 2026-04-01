export class HttpAdapterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly causeDetail?: unknown
  ) {
    super(message);
    this.name = 'HttpAdapterError';
  }
}

type FetchJsonOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {}
): Promise<{ status: number; data: T | null }> {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return { status: response.status, data: null };
  }

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as T) : null;
  return { status: response.status, data };
}

export function buildBearerHeaders(token?: string, apiKey?: string) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
}

export function unwrapDataEnvelope<T>(payload: T | { data?: T } | null): T | null {
  if (!payload) return null;
  if (typeof payload === 'object' && 'data' in payload) {
    return (payload as { data?: T }).data ?? null;
  }
  return payload as T;
}
