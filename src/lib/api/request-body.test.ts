import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  parseJsonObjectRequestBodyOrError,
  readJsonObjectRequestBody,
  readOptionalJsonObjectRequestBody,
} from './request-body';

type RequestInitWithDuplex = RequestInit & { duplex: 'half' };

function bodyRequest(body: BodyInit, signal?: AbortSignal) {
  return new Request('http://localhost/test', {
    method: 'POST',
    body,
    signal,
    duplex: 'half',
  } satisfies RequestInitWithDuplex);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('readJsonObjectRequestBody', () => {
  it('returns JSON objects from a real Request stream', async () => {
    await expect(readJsonObjectRequestBody(bodyRequest('{"id":"item_1"}'))).resolves.toEqual({
      id: 'item_1',
    });
  });

  it('returns null for non-object JSON values', async () => {
    await expect(readJsonObjectRequestBody(bodyRequest('["item_1"]'))).resolves.toBeNull();
  });

  it('returns null for malformed or invalid UTF-8 JSON', async () => {
    await expect(readJsonObjectRequestBody(bodyRequest('{"id":'))).resolves.toBeNull();
    await expect(
      readJsonObjectRequestBody(bodyRequest(new Uint8Array([0x7b, 0xff, 0x7d]))),
    ).resolves.toBeNull();
  });

  it('keeps the legacy null contract when the byte budget is exceeded', async () => {
    await expect(
      readJsonObjectRequestBody(bodyRequest('{"id":"item_1"}'), { maxBytes: 8 }),
    ).resolves.toBeNull();
  });
});

describe('parseJsonObjectRequestBodyOrError', () => {
  const schema = z.object({
    id: z.string().min(1),
  });

  it('returns parsed schema data for valid JSON objects', async () => {
    await expect(
      parseJsonObjectRequestBodyOrError(bodyRequest('{"id":"item_1"}'), schema),
    ).resolves.toEqual({
      ok: true,
      data: { id: 'item_1' },
    });
  });

  it('returns the standard validation response for malformed or non-object bodies', async () => {
    const result = await parseJsonObjectRequestBodyOrError(bodyRequest('{"id":'), schema);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected parse failure');
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
  });

  it('returns schema field errors without changing the validation message contract', async () => {
    const result = await parseJsonObjectRequestBodyOrError(bodyRequest('{}'), schema);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected schema failure');
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        id: expect.arrayContaining([expect.any(String)]),
      },
    });
  });

  it('returns the registered 413 envelope before parsing an oversized body', async () => {
    const safeParse = vi.fn((value: unknown) => schema.safeParse(value));
    const result = await parseJsonObjectRequestBodyOrError(
      bodyRequest('{"id":"item_1"}'),
      { safeParse },
      {},
      { maxBytes: 8 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected byte-budget failure');
    expect(result.response.status).toBe(413);
    await expect(result.response.json()).resolves.toEqual({
      code: 'REQUEST_BODY_TOO_LARGE',
      message: 'リクエストボディが上限を超えています',
      details: { max_bytes: 8 },
    });
    expect(safeParse).not.toHaveBeenCalled();
  });

  it('keeps client aborts on the raw-free invalid-body contract instead of mislabeling timeout', async () => {
    const controller = new AbortController();
    controller.abort(new Error('raw patient payload'));
    const result = await parseJsonObjectRequestBodyOrError(
      bodyRequest('{"id":"item_1"}', controller.signal),
      schema,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected aborted request failure');
    expect(result.response.status).toBe(400);
    const responseBody = await result.response.json();
    expect(responseBody).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(JSON.stringify(responseBody)).not.toContain('patient');
  });

  it('returns registered 408 details before schema parsing when the body deadline expires', async () => {
    vi.useFakeTimers();
    const safeParse = vi.fn((value: unknown) => schema.safeParse(value));
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined);
      },
    });
    const pending = parseJsonObjectRequestBodyOrError(
      bodyRequest(body),
      { safeParse },
      {},
      { deadlineMs: 25 },
    );

    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected body deadline failure');
    expect(result.response.status).toBe(408);
    await expect(result.response.json()).resolves.toEqual({
      code: 'REQUEST_BODY_TIMEOUT',
      message: 'リクエストボディの受信がタイムアウトしました',
      details: { timeout_ms: 25 },
    });
    expect(safeParse).not.toHaveBeenCalled();
  });
});

describe('readOptionalJsonObjectRequestBody', () => {
  it('returns JSON objects', async () => {
    await expect(
      readOptionalJsonObjectRequestBody(bodyRequest('{"id":"item_1"}')),
    ).resolves.toEqual({
      id: 'item_1',
    });
  });

  it('returns an empty object for absent, empty, or whitespace request bodies', async () => {
    const absent = new Request('http://localhost/test', { method: 'POST' });
    await expect(readOptionalJsonObjectRequestBody(absent)).resolves.toEqual({});
    await expect(readOptionalJsonObjectRequestBody(bodyRequest(''))).resolves.toEqual({});
    await expect(readOptionalJsonObjectRequestBody(bodyRequest('  \n'))).resolves.toEqual({});
  });

  it('returns null for non-object JSON values', async () => {
    await expect(readOptionalJsonObjectRequestBody(bodyRequest('[]'))).resolves.toBeNull();
  });

  it('returns null when parsing or bounded reading fails', async () => {
    await expect(readOptionalJsonObjectRequestBody(bodyRequest('{"id":'))).resolves.toBeNull();
    await expect(
      readOptionalJsonObjectRequestBody(bodyRequest('{"id":"item_1"}'), { maxBytes: 8 }),
    ).resolves.toBeNull();
  });
});
