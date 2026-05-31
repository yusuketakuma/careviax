import { describe, expect, it, vi } from 'vitest';
import { CURSOR_PAGE_LIMIT, fetchAllCursorPages } from './paginated-client';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

describe('paginated-client', () => {
  it('collects all cursor pages and preserves extra metadata from the first page', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'item_1' }],
          hasMore: true,
          nextCursor: 'cursor_1',
          deliverySummary: { pending_delivery_count: 3 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'item_2' }],
          hasMore: false,
          deliverySummary: { pending_delivery_count: 99 },
        }),
      );

    const result = await fetchAllCursorPages<
      { id: string },
      { deliverySummary: { pending_delivery_count: number } }
    >({
      path: '/api/example',
      orgId: 'org_1',
      fetchImpl,
      params: new URLSearchParams({ status: 'open' }),
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual([{ id: 'item_1' }, { id: 'item_2' }]);
    expect(result.deliverySummary.pending_delivery_count).toBe(3);
  });

  it('caps page size to the cursor API maximum', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        hasMore: false,
      }),
    );

    await fetchAllCursorPages({
      path: '/api/example',
      orgId: 'org_1',
      fetchImpl,
      limit: CURSOR_PAGE_LIMIT + 50,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`limit=${CURSOR_PAGE_LIMIT}`),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
      }),
    );
  });

  it('throws a controlled error when a cursor page has malformed shape', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: { id: 'not-array' },
        hasMore: 'yes',
        nextCursor: 'cursor_1',
      }),
    );

    await expect(
      fetchAllCursorPages({
        path: '/api/example',
        orgId: 'org_1',
        fetchImpl,
      }),
    ).rejects.toThrow('一覧データの取得に失敗しました');
  });
});
