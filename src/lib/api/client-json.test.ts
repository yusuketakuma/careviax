import { describe, expect, it } from 'vitest';

import { readApiJson } from './client-json';

describe('client JSON API helpers', () => {
  it('returns typed JSON for successful responses', async () => {
    const response = new Response(JSON.stringify({ data: [{ id: 'row_1' }] }), { status: 200 });

    await expect(readApiJson<{ data: Array<{ id: string }> }>(response)).resolves.toEqual({
      data: [{ id: 'row_1' }],
    });
  });

  it('uses response message for failed JSON responses', async () => {
    const response = new Response(JSON.stringify({ message: '入力を確認してください' }), {
      status: 400,
    });

    await expect(readApiJson(response)).rejects.toThrow('入力を確認してください');
  });

  it('uses response error for compatibility error envelopes', async () => {
    const response = new Response(JSON.stringify({ error: '権限がありません' }), { status: 403 });

    await expect(readApiJson(response)).rejects.toThrow('権限がありません');
  });

  it('falls back when failed JSON messages are blank', async () => {
    const response = new Response(JSON.stringify({ message: '   ', error: '' }), { status: 500 });

    await expect(readApiJson(response, '取得に失敗しました')).rejects.toThrow('取得に失敗しました');
  });

  it('uses the fallback message for non-JSON failures', async () => {
    const response = new Response('not-json', { status: 500 });

    await expect(readApiJson(response, '取得に失敗しました')).rejects.toThrow('取得に失敗しました');
  });

  it('ignores non-string message fields on failed JSON responses', async () => {
    const response = new Response(JSON.stringify({ message: 123 }), { status: 500 });

    await expect(readApiJson(response, '取得に失敗しました')).rejects.toThrow('取得に失敗しました');
  });

  it('rejects successful empty responses when JSON is required', async () => {
    const response = new Response(null, { status: 204 });

    await expect(readApiJson(response, 'レスポンスが不正です')).rejects.toThrow(
      'レスポンスが不正です',
    );
  });

  it('rejects successful non-JSON responses when JSON is required', async () => {
    const response = new Response('not-json', { status: 200 });

    await expect(readApiJson(response, 'レスポンスが不正です')).rejects.toThrow(
      'レスポンスが不正です',
    );
  });

  it('uses an optional schema parser for successful JSON responses', async () => {
    const schema = {
      safeParse(value: unknown) {
        if (value && typeof value === 'object' && 'data' in value && Array.isArray(value.data)) {
          return { success: true as const, data: value as { data: unknown[] } };
        }
        return { success: false as const };
      },
    };

    await expect(
      readApiJson(new Response(JSON.stringify({ data: [] }), { status: 200 }), {
        schema,
        fallbackMessage: 'レスポンスが不正です',
      }),
    ).resolves.toEqual({ data: [] });

    await expect(
      readApiJson(new Response(JSON.stringify({ rows: [] }), { status: 200 }), {
        schema,
        fallbackMessage: 'レスポンスが不正です',
      }),
    ).rejects.toThrow('レスポンスが不正です');
  });
});
