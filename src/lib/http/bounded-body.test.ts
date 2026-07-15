import { afterEach, describe, expect, it, vi } from 'vitest';
import { HARD_HTTP_BODY_MAX_BYTES, readBoundedBody } from './bounded-body';

type RequestInitWithDuplex = RequestInit & { duplex: 'half' };

function streamRequest(
  body: ReadableStream<Uint8Array>,
  options: { headers?: HeadersInit; signal?: AbortSignal } = {},
) {
  const init: RequestInitWithDuplex = {
    method: 'POST',
    body,
    headers: options.headers,
    signal: options.signal,
    duplex: 'half',
  };
  return new Request('http://localhost/test', init);
}

function textRequest(body: string, options: { headers?: HeadersInit; signal?: AbortSignal } = {}) {
  const init: RequestInitWithDuplex = {
    method: 'POST',
    body,
    headers: options.headers,
    signal: options.signal,
    duplex: 'half',
  };
  return new Request('http://localhost/test', init);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('readBoundedBody', () => {
  it('reads a real Request body without relying on Content-Length', async () => {
    const result = await readBoundedBody(textRequest('{"id":"item_1"}'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected body bytes');
    expect(new TextDecoder().decode(result.bytes)).toBe('{"id":"item_1"}');
  });

  it('reuses the same reader for Response bodies and an explicit abort signal', async () => {
    const response = new Response('{"resourceType":"Bundle"}');
    const result = await readBoundedBody(response);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected response bytes');
    expect(new TextDecoder().decode(result.bytes)).toBe('{"resourceType":"Bundle"}');

    const controller = new AbortController();
    controller.abort(new Error('raw provider detail'));
    await expect(
      readBoundedBody(new Response('{"resourceType":"Bundle"}'), {
        signal: controller.signal,
      }),
    ).resolves.toEqual({ ok: false, reason: 'aborted' });
  });

  it('returns an empty byte array when the request has no body', async () => {
    const request = new Request('http://localhost/test', { method: 'POST' });

    await expect(readBoundedBody(request)).resolves.toEqual({
      ok: true,
      bytes: new Uint8Array(),
    });
  });

  it('rejects an oversized Content-Length before reading and cancels the stream', async () => {
    let cancelled = false;
    const request = streamRequest(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'Content-Length': '9' } },
    );

    await expect(readBoundedBody(request, { maxBytes: 8 })).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it('treats Content-Length as preflight only and enforces streamed chunk bytes', async () => {
    let cancelled = false;
    const request = streamRequest(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.enqueue(new Uint8Array([5, 6, 7, 8]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'Content-Length': '1' } },
    );

    await expect(readBoundedBody(request, { maxBytes: 7 })).resolves.toEqual({
      ok: false,
      reason: 'too_large',
    });
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it('accepts the exact byte boundary and preserves split multibyte UTF-8', async () => {
    const encoded = new TextEncoder().encode('{"label":"薬"}');
    const splitInsideMultibyte = encoded.length - 3;
    const request = streamRequest(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.slice(0, splitInsideMultibyte));
          controller.enqueue(encoded.slice(splitInsideMultibyte));
          controller.close();
        },
      }),
    );

    const result = await readBoundedBody(request, { maxBytes: encoded.byteLength });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected body bytes');
    expect(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)).toBe('{"label":"薬"}');
  });

  it('clamps requested limits to the hard byte ceiling', async () => {
    const request = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'Content-Length': String(HARD_HTTP_BODY_MAX_BYTES + 1) },
    });

    await expect(
      readBoundedBody(request, { maxBytes: HARD_HTTP_BODY_MAX_BYTES * 2 }),
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects already-consumed and locked real Request streams', async () => {
    const consumed = textRequest('{"id":"item_1"}');
    await consumed.text();
    await expect(readBoundedBody(consumed)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });

    const locked = textRequest('{"id":"item_1"}');
    const reader = locked.body?.getReader();
    if (!reader) throw new Error('expected request body');
    await expect(readBoundedBody(locked)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
    });
    reader.releaseLock();
  });

  it('returns an aborted failure without exposing the abort reason', async () => {
    const controller = new AbortController();
    controller.abort(new Error('raw patient payload'));
    let cancelled = false;
    const request = streamRequest(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode('{"id":"item_1"}'));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { signal: controller.signal },
    );

    const result = await readBoundedBody(request);

    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(JSON.stringify(result)).not.toContain('patient');
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it('bounds a stalled body by deadline and keeps cancellation failure secondary', async () => {
    vi.useFakeTimers();
    let cancelAttempted = false;
    const request = streamRequest(
      new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => undefined);
        },
        cancel() {
          cancelAttempted = true;
          throw new Error('raw cancellation detail');
        },
      }),
    );

    const pending = readBoundedBody(request, { deadlineMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
    await Promise.resolve();
    expect(cancelAttempted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a stalled body when the request signal aborts', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const request = streamRequest(
      new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => undefined);
        },
        cancel() {
          cancelled = true;
        },
      }),
      { signal: controller.signal },
    );

    const pending = readBoundedBody(request);
    controller.abort(new Error('raw disconnect detail'));

    await expect(pending).resolves.toEqual({ ok: false, reason: 'aborted' });
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it('returns a fixed unreadable failure for stream errors', async () => {
    const request = streamRequest(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error('raw body detail'));
        },
      }),
    );

    const result = await readBoundedBody(request);

    expect(result).toEqual({ ok: false, reason: 'unreadable' });
    expect(JSON.stringify(result)).not.toContain('raw body detail');
  });

  it('clears the deadline and releases the stream lock after success', async () => {
    vi.useFakeTimers();
    const request = textRequest('{"id":"item_1"}');

    const result = await readBoundedBody(request, { deadlineMs: 25 });

    expect(result.ok).toBe(true);
    expect(request.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
