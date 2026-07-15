import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_HTTP_BODY_MAX_BYTES } from '@/lib/http/bounded-body';
import { fetchJson, HttpAdapterError, unwrapDataEnvelope } from './http-client';

function chunkedResponse(
  chunks: readonly Uint8Array[],
  options: { status?: number; headers?: HeadersInit; cancel?: () => void; close?: boolean } = {},
) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        if (options.close !== false) controller.close();
      },
      cancel: options.cancel,
    }),
    { status: options.status ?? 200, headers: options.headers },
  );
}

function stalledResponse(cancel?: () => void) {
  return new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined);
      },
      cancel,
    }),
    { status: 200 },
  );
}

describe('http-client adapter helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('parses JSON responses as unknown data and applies JSON request headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchJson('https://partner.example.test/resource', {
      method: 'POST',
      headers: { 'x-api-key': 'api-key' },
      body: { id: 'resource_1' },
    });

    expect(result).toEqual({ status: 200, data: { data: { ok: true } } });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://partner.example.test/resource',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': 'api-key',
        },
        body: JSON.stringify({ id: 'resource_1' }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('uses an unrefed cleanup timer for adapter requests', async () => {
    vi.stubEnv('HTTP_ADAPTER_TIMEOUT_MS', '1200');
    const unref = vi.fn();
    const timeoutHandle = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((() => timeoutHandle) as unknown as typeof setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchJson('https://partner.example.test/resource')).resolves.toEqual({
      status: 200,
      data: {},
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://partner.example.test/resource',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1200);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });

  it.each([204, 205, 304])(
    'returns null data for HTTP %s without applying representation Content-Length',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(null, {
            status,
            headers: { 'Content-Length': String(DEFAULT_HTTP_BODY_MAX_BYTES + 1) },
          }),
        ),
      );

      await expect(fetchJson('https://partner.example.test/no-content')).resolves.toEqual({
        status,
        data: null,
      });
    },
  );

  it.each([
    ['missing', undefined],
    ['lying-low', '1'],
  ])(
    'rejects a streamed response over the default byte budget with %s Content-Length',
    async (_label, contentLength) => {
      const cancel = vi.fn();
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (contentLength !== undefined) headers.set('Content-Length', contentLength);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          chunkedResponse([new Uint8Array(DEFAULT_HTTP_BODY_MAX_BYTES), new Uint8Array([1])], {
            headers,
            cancel,
            close: false,
          }),
        ),
      );

      const error = await fetchJson('https://partner.example.test/oversized').catch(
        (cause: unknown) => cause,
      );

      expect(error).toMatchObject({
        name: 'HttpAdapterError',
        status: 200,
        causeDetail: {
          reason: 'response_body_too_large',
          upstream_status: 200,
          max_bytes: DEFAULT_HTTP_BODY_MAX_BYTES,
        },
      } satisfies Partial<HttpAdapterError>);
      await Promise.resolve();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it('accepts the exact byte boundary and decodes split multibyte UTF-8 after the full read', async () => {
    const encoded = new TextEncoder().encode('{"label":"薬"}');
    const splitInsideCharacter = encoded.byteLength - 4;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          chunkedResponse([
            encoded.slice(0, splitInsideCharacter),
            encoded.slice(splitInsideCharacter),
          ]),
        ),
    );

    await expect(
      fetchJson('https://partner.example.test/multibyte', {
        maxResponseBytes: encoded.byteLength,
      }),
    ).resolves.toEqual({ status: 200, data: { label: '薬' } });
  });

  it('bounds a headers-fast stalled body at the 30 second reader deadline', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return Promise.resolve(stalledResponse(cancel));
      }),
    );

    const pending = fetchJson('https://partner.example.test/stalled', { timeoutMs: 60_000 });
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'HttpAdapterError',
      status: undefined,
      causeDetail: {
        reason: 'response_body_timeout',
        deadline_ms: 30_000,
      },
    } satisfies Partial<HttpAdapterError>);
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(requestSignal?.aborted).toBe(false);
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('maps response stream failures to a fixed transport error without raw details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(new Error('raw patient response detail'));
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const error = await fetchJson('https://partner.example.test/unreadable').catch(
      (cause: unknown) => cause,
    );

    expect(error).toMatchObject({
      name: 'HttpAdapterError',
      status: undefined,
      causeDetail: { reason: 'response_body_unreadable' },
    } satisfies Partial<HttpAdapterError>);
    expect(JSON.stringify((error as HttpAdapterError).causeDetail)).not.toContain('patient');
  });

  it('rejects invalid UTF-8 with fixed metadata and no decoded response detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(chunkedResponse([new Uint8Array([0xc3, 0x28])], { status: 502 })),
    );

    const error = await fetchJson('https://partner.example.test/invalid-utf8').catch(
      (cause: unknown) => cause,
    );

    expect(error).toMatchObject({
      name: 'HttpAdapterError',
      status: 502,
      causeDetail: {
        reason: 'response_body_invalid_utf8',
        upstream_status: 502,
      },
    } satisfies Partial<HttpAdapterError>);
  });

  it('throws a typed adapter error for invalid JSON response bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('patient-name-must-not-leak', { status: 502 })),
    );

    const error = await fetchJson('https://partner.example.test/bad-json').catch(
      (cause: unknown) => cause,
    );

    expect(error).toMatchObject({
      name: 'HttpAdapterError',
      message: 'Response body is not valid JSON (HTTP 502)',
      status: 502,
      causeDetail: {
        reason: 'response_body_invalid_json',
        upstream_status: 502,
      },
    } satisfies Partial<HttpAdapterError>);
    expect(JSON.stringify((error as HttpAdapterError).causeDetail)).not.toContain('patient');
  });

  it('unwraps data envelopes without trusting a caller-provided response type', () => {
    expect(unwrapDataEnvelope({ data: { id: 'resource_1' } })).toEqual({ id: 'resource_1' });
    expect(unwrapDataEnvelope({ data: null })).toBeNull();
    expect(unwrapDataEnvelope({ id: 'resource_1' })).toEqual({ id: 'resource_1' });
    expect(unwrapDataEnvelope(null)).toBeNull();
  });
});
