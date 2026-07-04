import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  parseJsonObjectRequestBodyOrError,
  readJsonObjectRequestBody,
  readOptionalJsonObjectRequestBody,
} from './request-body';

describe('readJsonObjectRequestBody', () => {
  it('returns JSON objects', async () => {
    await expect(
      readJsonObjectRequestBody({ json: async () => ({ id: 'item_1' }) }),
    ).resolves.toEqual({
      id: 'item_1',
    });
  });

  it('returns null for non-object JSON values', async () => {
    await expect(readJsonObjectRequestBody({ json: async () => ['item_1'] })).resolves.toBeNull();
  });

  it('returns null when JSON parsing fails', async () => {
    await expect(
      readJsonObjectRequestBody({
        json: async () => {
          throw new Error('invalid json');
        },
      }),
    ).resolves.toBeNull();
  });
});

describe('parseJsonObjectRequestBodyOrError', () => {
  const schema = z.object({
    id: z.string().min(1),
  });

  it('returns parsed schema data for valid JSON objects', async () => {
    await expect(
      parseJsonObjectRequestBodyOrError({ json: async () => ({ id: 'item_1' }) }, schema),
    ).resolves.toEqual({
      ok: true,
      data: { id: 'item_1' },
    });
  });

  it('returns the standard validation response for malformed or non-object bodies', async () => {
    const result = await parseJsonObjectRequestBodyOrError(
      {
        json: async () => {
          throw new Error('invalid json');
        },
      },
      schema,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected parse failure');
    expect(result.response.status).toBe(400);
    await expect(result.response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
  });

  it('returns schema field errors without changing the validation message contract', async () => {
    const result = await parseJsonObjectRequestBodyOrError({ json: async () => ({}) }, schema);

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
});

describe('readOptionalJsonObjectRequestBody', () => {
  it('returns JSON objects', async () => {
    await expect(
      readOptionalJsonObjectRequestBody({ text: async () => '{"id":"item_1"}' }),
    ).resolves.toEqual({
      id: 'item_1',
    });
  });

  it('returns an empty object for empty request bodies', async () => {
    await expect(readOptionalJsonObjectRequestBody({ text: async () => '' })).resolves.toEqual({});
  });

  it('returns null for non-object JSON values', async () => {
    await expect(readOptionalJsonObjectRequestBody({ text: async () => '[]' })).resolves.toBeNull();
  });

  it('returns null when JSON parsing fails', async () => {
    await expect(
      readOptionalJsonObjectRequestBody({ text: async () => '{"id":' }),
    ).resolves.toBeNull();
  });
});
