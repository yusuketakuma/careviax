import { describe, expect, it } from 'vitest';
import { readJsonObjectRequestBody, readOptionalJsonObjectRequestBody } from './request-body';

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
