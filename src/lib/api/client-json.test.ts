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

  it('uses the fallback message for non-JSON failures', async () => {
    const response = new Response('not-json', { status: 500 });

    await expect(readApiJson(response, '取得に失敗しました')).rejects.toThrow('取得に失敗しました');
  });

  it('ignores non-string message fields on failed JSON responses', async () => {
    const response = new Response(JSON.stringify({ message: 123 }), { status: 500 });

    await expect(readApiJson(response, '取得に失敗しました')).rejects.toThrow('取得に失敗しました');
  });
});
