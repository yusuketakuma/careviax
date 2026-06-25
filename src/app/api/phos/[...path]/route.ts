import { NextRequest, NextResponse } from 'next/server';
import { getAuthAccessToken } from '@/lib/auth/config';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import type { ErrorResponse } from '@/phos/contracts/phos_contracts';
import { PHOS_API_ROUTES, type PhosApiRoute } from '@/phos/infra/api-gateway-routes';
import { createFetchTimeout } from '@/server/services/fetch-timeout';

export const dynamic = 'force-dynamic';

type PhosProxyRouteContext = {
  params: Promise<{ path?: string[] }>;
};

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORWARDED_REQUEST_HEADERS = ['accept', 'content-type', 'idempotency-key', 'x-correlation-id'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'etag', 'last-modified', 'x-request-id'];
const DEFAULT_PHOS_PROXY_UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_PHOS_PROXY_UPSTREAM_TIMEOUT_MS = 60_000;
const MAX_PHOS_PROXY_QUERY_LENGTH = 8192;
const MAX_PHOS_PROXY_QUERY_PARAM_COUNT = 32;
const MAX_PHOS_PROXY_QUERY_KEY_LENGTH = 64;
const MAX_PHOS_PROXY_QUERY_VALUE_LENGTH = 2048;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { code, message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    },
  );
}

function phosProxyValidationError(
  request: NextRequest,
  status: number,
  messageKey: string,
  details: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      request_id: request.headers.get('x-correlation-id') ?? '',
      error_code: 'VALIDATION_ERROR',
      message_key: messageKey,
      details,
    } satisfies ErrorResponse,
    {
      status,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    },
  );
}

function normalizeUpstreamBaseUrl(): string | null {
  const value = process.env.PHOS_API_BASE_URL ?? process.env.NEXT_PUBLIC_PHOS_API_BASE_URL;
  const trimmed = value?.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(parsed.hostname)) return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  return trimmed;
}

function resolveUpstreamTimeoutMs() {
  return normalizePositiveTimeoutMs(process.env.PHOS_PROXY_UPSTREAM_TIMEOUT_MS, {
    fallbackMs: DEFAULT_PHOS_PROXY_UPSTREAM_TIMEOUT_MS,
    maxMs: MAX_PHOS_PROXY_UPSTREAM_TIMEOUT_MS,
  });
}

function routeSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function isPathParamSegment(segment: string): boolean {
  return segment.startsWith('{') && segment.endsWith('}');
}

function isSafeDynamicSegment(segment: string): boolean {
  return Boolean(segment) && segment !== '.' && segment !== '..' && !segment.includes('/');
}

function findCatalogRoute(method: string, path: string): PhosApiRoute | null {
  const requestSegments = routeSegments(path);
  return (
    PHOS_API_ROUTES.find((route) => {
      if (route.method !== method) return false;
      const catalogSegments = routeSegments(route.path);
      if (catalogSegments.length !== requestSegments.length) return false;
      return catalogSegments.every((segment, index) => {
        const requestSegment = requestSegments[index];
        if (requestSegment === undefined) return false;
        return isPathParamSegment(segment)
          ? isSafeDynamicSegment(requestSegment)
          : segment === requestSegment;
      });
    }) ?? null
  );
}

function buildProxyPath(path: string[] | undefined): string | null {
  if (!path?.length) return null;
  const encodedSegments = path.map((segment) => {
    if (!isSafeDynamicSegment(segment)) return null;
    return encodeURIComponent(segment);
  });
  if (encodedSegments.some((segment) => segment === null)) return null;
  return `/${encodedSegments.join('/')}`;
}

function buildUpstreamHeaders(request: NextRequest, accessToken: string): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${accessToken}`);
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  return headers;
}

function buildResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstreamHeaders.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function encodedComponentLength(value: string): number {
  return encodeURIComponent(value).length;
}

function validateProxyQuery(request: NextRequest): Response | null {
  const encodedQuery = request.nextUrl.searchParams.toString();
  if (encodedQuery.length > MAX_PHOS_PROXY_QUERY_LENGTH) {
    return phosProxyValidationError(request, 414, 'api.error.query_too_long', {
      max_query_length: MAX_PHOS_PROXY_QUERY_LENGTH,
    });
  }

  const seen = new Set<string>();
  let paramCount = 0;
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    paramCount += 1;
    if (paramCount > MAX_PHOS_PROXY_QUERY_PARAM_COUNT) {
      return phosProxyValidationError(request, 400, 'api.error.validation.generic', {
        field: 'query',
        max_param_count: MAX_PHOS_PROXY_QUERY_PARAM_COUNT,
      });
    }
    if (seen.has(key)) {
      return phosProxyValidationError(request, 400, 'api.error.validation.generic', {
        field: key,
        reason: 'duplicate_query_key',
      });
    }
    seen.add(key);
    if (encodedComponentLength(key) > MAX_PHOS_PROXY_QUERY_KEY_LENGTH) {
      return phosProxyValidationError(request, 400, 'api.error.validation.generic', {
        field: 'query_key',
        max_key_length: MAX_PHOS_PROXY_QUERY_KEY_LENGTH,
      });
    }
    if (encodedComponentLength(value) > MAX_PHOS_PROXY_QUERY_VALUE_LENGTH) {
      return phosProxyValidationError(request, 400, 'api.error.validation.generic', {
        field: key,
        max_value_length: MAX_PHOS_PROXY_QUERY_VALUE_LENGTH,
      });
    }
  }

  return null;
}

async function proxyPhosRequest(request: NextRequest, context: PhosProxyRouteContext) {
  const [{ path }, accessToken] = await Promise.all([context.params, getAuthAccessToken(request)]);
  if (!accessToken) {
    return jsonError(401, 'AUTHENTICATION_REQUIRED', 'PH-OS API authentication is required');
  }

  const proxyPath = buildProxyPath(path);
  if (!proxyPath || !findCatalogRoute(request.method, proxyPath)) {
    return jsonError(404, 'PHOS_ROUTE_NOT_FOUND', 'PH-OS API route is not available');
  }

  const queryError = validateProxyQuery(request);
  if (queryError) return queryError;

  const upstreamBaseUrl = normalizeUpstreamBaseUrl();
  if (!upstreamBaseUrl) {
    return jsonError(503, 'PHOS_UPSTREAM_NOT_CONFIGURED', 'PH-OS API upstream is not configured');
  }

  const upstreamUrl = new URL(`${upstreamBaseUrl}${proxyPath}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.append(key, value);
  });

  const body = request.method === 'GET' ? undefined : await request.arrayBuffer();
  const abort = createFetchTimeout(
    resolveUpstreamTimeoutMs(),
    new Error('PHOS_PROXY_UPSTREAM_TIMEOUT'),
  );
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: buildUpstreamHeaders(request, accessToken),
      cache: 'no-store',
      redirect: 'error',
      signal: abort.signal,
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    if (abort.signal.aborted) {
      return jsonError(504, 'PHOS_UPSTREAM_TIMEOUT', 'PH-OS API upstream timed out');
    }
    return jsonError(502, 'PHOS_UPSTREAM_UNAVAILABLE', 'PH-OS API upstream is unavailable');
  } finally {
    abort.clear();
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: buildResponseHeaders(upstreamResponse.headers),
  });
}

export async function GET(request: NextRequest, context: PhosProxyRouteContext) {
  return proxyPhosRequest(request, context);
}

export async function POST(request: NextRequest, context: PhosProxyRouteContext) {
  return proxyPhosRequest(request, context);
}
