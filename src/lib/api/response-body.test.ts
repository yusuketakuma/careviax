import { describe, expect, it } from 'vitest';
import { readJsonObjectResponseBody, readJsonResponseBody } from './response-body';

describe('readJsonResponseBody', () => {
  it('returns parsed JSON response bodies', async () => {
    await expect(
      readJsonResponseBody({ json: async () => ({ code: 'VALIDATION_ERROR' }) }),
    ).resolves.toEqual({
      code: 'VALIDATION_ERROR',
    });
  });

  it('returns null when response JSON parsing fails', async () => {
    await expect(
      readJsonResponseBody({
        json: async () => {
          throw new SyntaxError('invalid json');
        },
      }),
    ).resolves.toBeNull();
  });
});

describe('readJsonObjectResponseBody', () => {
  it('returns parsed JSON object response bodies', async () => {
    await expect(
      readJsonObjectResponseBody({ json: async () => ({ message: 'failed' }) }),
    ).resolves.toEqual({
      message: 'failed',
    });
  });

  it('returns null for non-object JSON response bodies', async () => {
    await expect(
      readJsonObjectResponseBody({ json: async () => ['unexpected'] }),
    ).resolves.toBeNull();
  });
});
