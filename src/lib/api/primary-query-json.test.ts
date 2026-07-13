import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  canRetainCachedDataAfterPrimaryQueryError,
  fetchPrimaryQueryJson,
  PrimaryQueryError,
} from './primary-query-json';

const responseSchema = z.object({ data: z.object({ id: z.literal('patient_1') }) });

async function capturePrimaryQueryError(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(PrimaryQueryError);
    return error;
  }
  throw new Error('Expected the primary query to fail');
}

describe('fetchPrimaryQueryJson', () => {
  it('allows cached data to remain visible for network failures', async () => {
    const error = await capturePrimaryQueryError(() =>
      fetchPrimaryQueryJson(
        async () => {
          throw new TypeError('network details must not escape');
        },
        { fallbackMessage: '患者情報を取得できませんでした', schema: responseSchema },
      ),
    );

    expect(error).toMatchObject({
      message: '患者情報を取得できませんでした',
      status: null,
    });
    expect(canRetainCachedDataAfterPrimaryQueryError(error)).toBe(true);
  });

  it('allows cached data to remain visible for server failures', async () => {
    const error = await capturePrimaryQueryError(() =>
      fetchPrimaryQueryJson(
        async () => new Response('sensitive upstream detail', { status: 503 }),
        {
          fallbackMessage: '患者情報を取得できませんでした',
          schema: responseSchema,
        },
      ),
    );

    expect(error).toMatchObject({
      message: '患者情報を取得できませんでした',
      status: 503,
    });
    expect(canRetainCachedDataAfterPrimaryQueryError(error)).toBe(true);
  });

  it.each([401, 403, 404, 429])(
    'requires cached data to be hidden after an HTTP %s response',
    async (status) => {
      const error = await capturePrimaryQueryError(() =>
        fetchPrimaryQueryJson(
          async () =>
            new Response(JSON.stringify({ error: { message: 'sensitive detail' } }), {
              status,
              headers: { 'Content-Type': 'application/json' },
            }),
          { fallbackMessage: '患者情報を取得できませんでした', schema: responseSchema },
        ),
      );

      expect(error).toMatchObject({
        message: '患者情報を取得できませんでした',
        status,
      });
      expect(canRetainCachedDataAfterPrimaryQueryError(error)).toBe(false);
    },
  );

  it('requires cached data to be hidden after a malformed successful response', async () => {
    const error = await capturePrimaryQueryError(() =>
      fetchPrimaryQueryJson(
        async () =>
          new Response(JSON.stringify({ data: { id: 'different_patient' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        { fallbackMessage: '患者情報を取得できませんでした', schema: responseSchema },
      ),
    );

    expect(error).toMatchObject({
      message: '患者情報を取得できませんでした',
      status: 200,
    });
    expect(canRetainCachedDataAfterPrimaryQueryError(error)).toBe(false);
  });
});
