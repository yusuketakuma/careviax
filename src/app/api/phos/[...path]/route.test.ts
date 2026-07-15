import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthAccessTokenMock } = vi.hoisted(() => ({
  getAuthAccessTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  getAuthAccessToken: getAuthAccessTokenMock,
}));

import { GET, POST } from './route';

const originalPhosApiBaseUrl = process.env.PHOS_API_BASE_URL;
const originalPublicPhosApiBaseUrl = process.env.NEXT_PUBLIC_PHOS_API_BASE_URL;
const originalPhosProxyUpstreamTimeoutMs = process.env.PHOS_PROXY_UPSTREAM_TIMEOUT_MS;
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;
type NextRequestInitWithDuplex = NextRequestInit & { duplex: 'half' };

function request(url: string, init: NextRequestInit = {}) {
  return new NextRequest(url, init);
}

function streamingPostRequest(
  url: string,
  body: ReadableStream<Uint8Array>,
  options: { headers?: HeadersInit; signal?: AbortSignal } = {},
) {
  const init: NextRequestInitWithDuplex = {
    method: 'POST',
    body,
    headers: options.headers,
    signal: options.signal,
    duplex: 'half',
  };
  return new NextRequest(url, init);
}

function closedChunkStream(chunks: Uint8Array[], cancel?: () => void) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
}

function stalledChunkStream(chunks: Uint8Array[] = [], cancel?: () => void) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    cancel,
  });
}

function splitInsideFirstMultibyteCharacter(bytes: Uint8Array) {
  const firstMultibyteByte = bytes.findIndex((byte) => byte >= 0x80);
  if (firstMultibyteByte < 0) throw new Error('expected multibyte test data');
  const splitAt = firstMultibyteByte + 1;
  return [bytes.slice(0, splitAt), bytes.slice(splitAt)];
}

async function readBodyInitBytes(body: BodyInit | null | undefined) {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

describe('/api/phos proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PHOS_API_BASE_URL = 'https://api.example.com/prod';
    delete process.env.NEXT_PUBLIC_PHOS_API_BASE_URL;
  });

  afterEach(() => {
    if (originalPhosApiBaseUrl === undefined) delete process.env.PHOS_API_BASE_URL;
    else process.env.PHOS_API_BASE_URL = originalPhosApiBaseUrl;
    if (originalPublicPhosApiBaseUrl === undefined)
      delete process.env.NEXT_PUBLIC_PHOS_API_BASE_URL;
    else process.env.NEXT_PUBLIC_PHOS_API_BASE_URL = originalPublicPhosApiBaseUrl;
    if (originalPhosProxyUpstreamTimeoutMs === undefined)
      delete process.env.PHOS_PROXY_UPSTREAM_TIMEOUT_MS;
    else process.env.PHOS_PROXY_UPSTREAM_TIMEOUT_MS = originalPhosProxyUpstreamTimeoutMs;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('forwards catalog requests with a server-side bearer token', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { side_effects: [], server_version: 2 },
        { headers: { 'x-request-id': 'upstream_req_1' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      request('http://localhost/api/phos/cards/card_1/actions?trace=1', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idem_1',
          'x-correlation-id': 'corr_1',
        },
        body: JSON.stringify({ action_code: 'CONFIRM_PRESCRIPTION_DIFF' }),
      }),
      { params: Promise.resolve({ path: ['cards', 'card_1', 'actions'] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('x-request-id')).toBe('upstream_req_1');
    expect(await response.json()).toEqual({ side_effects: [], server_version: 2 });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0]!;
    if (!init) throw new Error('expected fetch init');
    expect(String(url)).toBe('https://api.example.com/prod/cards/card_1/actions?trace=1');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
      }),
    );
    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer server-access-token');
    expect(headers.get('idempotency-key')).toBe('idem_1');
    expect(headers.get('x-correlation-id')).toBe('corr_1');
    expect(headers.get('cookie')).toBeNull();
  });

  it('preserves split multibyte request and response bytes while buffering allowed headers', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const requestBytes = new TextEncoder().encode('{"action_code":"確認"}');
    const responseBytes = new TextEncoder().encode('{"message":"受付済み"}');
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      expect(await readBodyInitBytes(init?.body)).toEqual(requestBytes);
      return new Response(closedChunkStream(splitInsideFirstMultibyteCharacter(responseBytes)), {
        status: 201,
        statusText: 'Created',
        headers: {
          'content-type': 'application/json',
          etag: '"response-v1"',
          'last-modified': 'Wed, 15 Jul 2026 00:00:00 GMT',
          'x-request-id': 'upstream_req_multibyte',
          'set-cookie': 'upstream-secret=hidden',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      streamingPostRequest(
        'http://localhost/api/phos/cards/card_1/actions',
        closedChunkStream(splitInsideFirstMultibyteCharacter(requestBytes)),
        { headers: { 'content-type': 'application/json' } },
      ),
      { params: Promise.resolve({ path: ['cards', 'card_1', 'actions'] }) },
    );

    expect(response.status).toBe(201);
    expect(response.statusText).toBe('Created');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(responseBytes);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('etag')).toBe('"response-v1"');
    expect(response.headers.get('last-modified')).toBe('Wed, 15 Jul 2026 00:00:00 GMT');
    expect(response.headers.get('x-request-id')).toBe('upstream_req_multibyte');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    ['missing', undefined],
    ['lying low', '1'],
  ])(
    'rejects chunked request bodies over 256 KiB with %s Content-Length',
    async (_label, contentLength) => {
      getAuthAccessTokenMock.mockResolvedValue('server-access-token');
      const cancel = vi.fn();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const headers = new Headers({ 'content-type': 'application/octet-stream' });
      if (contentLength !== undefined) headers.set('content-length', contentLength);

      const response = await POST(
        streamingPostRequest(
          'http://localhost/api/phos/cards/card_1/actions',
          stalledChunkStream([new Uint8Array(256 * 1024), new Uint8Array([1])], cancel),
          { headers },
        ),
        { params: Promise.resolve({ path: ['cards', 'card_1', 'actions'] }) },
      );

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toEqual({
        code: 'PHOS_REQUEST_BODY_TOO_LARGE',
        message: 'PH-OS API request body is too large',
      });
      expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it('cancels stalled request bodies at the 10 second ingress deadline', async () => {
    vi.useFakeTimers();
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const cancel = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = POST(
      streamingPostRequest(
        'http://localhost/api/phos/cards/card_1/actions',
        stalledChunkStream([new TextEncoder().encode('{"action_code":')], cancel),
        { headers: { 'content-type': 'application/json' } },
      ),
      { params: Promise.resolve({ path: ['cards', 'card_1', 'actions'] }) },
    );
    await vi.advanceTimersByTimeAsync(10_000);

    const response = await responsePromise;
    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toEqual({
      code: 'PHOS_REQUEST_BODY_TIMEOUT',
      message: 'PH-OS API request body timed out',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('maps a client-aborted request body to a fixed unreadable response', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const controller = new AbortController();
    controller.abort(new Error('patient-name-must-not-leak'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      streamingPostRequest('http://localhost/api/phos/cards/card_1/actions', stalledChunkStream(), {
        signal: controller.signal,
      }),
      { params: Promise.resolve({ path: ['cards', 'card_1', 'actions'] }) },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      code: 'PHOS_REQUEST_BODY_UNREADABLE',
      message: 'PH-OS API request body is unreadable',
    });
    expect(JSON.stringify(body)).not.toContain('patient-name-must-not-leak');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized query strings before reaching the upstream API', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request(`http://localhost/api/phos/cards?q=${'a'.repeat(8193)}`), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(414);
    await expect(response.json()).resolves.toMatchObject({
      request_id: '',
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.query_too_long',
      details: { max_query_length: 8192 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects excessive query parameter counts before reaching the upstream API', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const query = Array.from({ length: 33 }, (_, index) => `p${index}=1`).join('&');

    const response = await GET(request(`http://localhost/api/phos/cards?${query}`), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.validation.generic',
      details: { field: 'query', max_param_count: 32 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate query keys before reaching the upstream API', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/cards?limit=1&limit=50'), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.validation.generic',
      details: { field: 'limit', reason: 'duplicate_query_key' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized query keys and values before reaching the upstream API', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const longKeyResponse = await GET(
      request(`http://localhost/api/phos/cards?${'k'.repeat(65)}=1`),
      {
        params: Promise.resolve({ path: ['cards'] }),
      },
    );
    expect(longKeyResponse.status).toBe(400);
    await expect(longKeyResponse.json()).resolves.toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'query_key', max_key_length: 64 },
    });

    const longValueResponse = await GET(
      request(`http://localhost/api/phos/cards?cursor=${'v'.repeat(2049)}`),
      {
        params: Promise.resolve({ path: ['cards'] }),
      },
    );
    expect(longValueResponse.status).toBe(400);
    await expect(longValueResponse.json()).resolves.toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'cursor', max_value_length: 2048 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before reaching the upstream API', async () => {
    getAuthAccessTokenMock.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects paths outside the PH-OS route catalog', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/admin/secrets'), {
      params: Promise.resolve({ path: ['admin', 'secrets'] }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'PHOS_ROUTE_NOT_FOUND' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts stalled upstream requests with a bounded gateway timeout', async () => {
    vi.useFakeTimers();
    process.env.PHOS_PROXY_UPSTREAM_TIMEOUT_MS = '5';
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          observedSignal = init?.signal ?? undefined;
          observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), {
            once: true,
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });
    await vi.advanceTimersByTimeAsync(5);

    const response = await responsePromise;
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ code: 'PHOS_UPSTREAM_TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toEqual(new Error('PHOS_PROXY_UPSTREAM_TIMEOUT'));
  });

  it('keeps the upstream timeout armed while a response body is stalled', async () => {
    vi.useFakeTimers();
    process.env.PHOS_PROXY_UPSTREAM_TIMEOUT_MS = '5';
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const cancel = vi.fn();
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Response(stalledChunkStream([new TextEncoder().encode('{')], cancel), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });
    await vi.advanceTimersByTimeAsync(5);

    const response = await responsePromise;
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      code: 'PHOS_UPSTREAM_TIMEOUT',
      message: 'PH-OS API upstream timed out',
    });
    expect(observedSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('applies the explicit 30 second response-body hard deadline under a 60 second total timeout', async () => {
    vi.useFakeTimers();
    process.env.PHOS_PROXY_UPSTREAM_TIMEOUT_MS = '60000';
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const cancel = vi.fn();
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Response(stalledChunkStream([], cancel), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });
    await vi.advanceTimersByTimeAsync(30_000);

    const response = await responsePromise;
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({ code: 'PHOS_UPSTREAM_TIMEOUT' });
    expect(observedSignal?.aborted).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an oversized streamed upstream response before returning partial bytes', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const cancel = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          stalledChunkStream([new Uint8Array(1024 * 1024), new Uint8Array([1])], cancel),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: 'PHOS_UPSTREAM_RESPONSE_TOO_LARGE',
      message: 'PH-OS API upstream response is too large',
    });
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('maps upstream response stream failures to a fixed unavailable error', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const unsafeError = new Error('upstream-patient-data-must-not-leak');
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(unsafeError);
            },
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      code: 'PHOS_UPSTREAM_UNAVAILABLE',
      message: 'PH-OS API upstream is unavailable',
    });
    expect(JSON.stringify(body)).not.toContain(unsafeError.message);
  });

  it.each([200, 204, 205, 304])('preserves a null upstream body for HTTP %i', async (status) => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    await expect(response.text()).resolves.toBe('');
  });

  it('returns a null 304 body without treating representation Content-Length as payload bytes', async () => {
    getAuthAccessTokenMock.mockResolvedValue('server-access-token');
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 304,
          headers: {
            'content-length': String(1024 * 1024 + 1),
            etag: '"cached-v2"',
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(request('http://localhost/api/phos/cards'), {
      params: Promise.resolve({ path: ['cards'] }),
    });

    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get('etag')).toBe('"cached-v2"');
    await expect(response.text()).resolves.toBe('');
  });
});
