import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchJson, HttpAdapterError, unwrapDataEnvelope } from './http-client';

describe('http-client adapter helpers', () => {
  afterEach(() => {
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

  it('returns null data for no-content responses without reading a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(fetchJson('https://partner.example.test/no-content')).resolves.toEqual({
      status: 204,
      data: null,
    });
  });

  it('throws a typed adapter error for invalid JSON response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 502 })));

    await expect(fetchJson('https://partner.example.test/bad-json')).rejects.toMatchObject({
      name: 'HttpAdapterError',
      message: 'Response body is not valid JSON (HTTP 502)',
      status: 502,
    } satisfies Partial<HttpAdapterError>);
  });

  it('unwraps data envelopes without trusting a caller-provided response type', () => {
    expect(unwrapDataEnvelope({ data: { id: 'resource_1' } })).toEqual({ id: 'resource_1' });
    expect(unwrapDataEnvelope({ data: null })).toBeNull();
    expect(unwrapDataEnvelope({ id: 'resource_1' })).toEqual({ id: 'resource_1' });
    expect(unwrapDataEnvelope(null)).toBeNull();
  });
});
