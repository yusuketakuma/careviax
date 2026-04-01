import { describe, expect, it, vi } from 'vitest';
import { CURSOR_PAGE_LIMIT, fetchAllCursorPages } from './paginated-client';

describe('paginated-client', () => {
  it('collects all cursor pages and preserves extra metadata from the first page', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'item_1' }],
          hasMore: true,
          nextCursor: 'cursor_1',
          deliverySummary: { pending_delivery_count: 3 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'item_2' }],
          hasMore: false,
          deliverySummary: { pending_delivery_count: 99 },
        }),
      });

    const result = await fetchAllCursorPages<
      { id: string },
      { deliverySummary: { pending_delivery_count: number } }
    >({
      path: '/api/example',
      orgId: 'org_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      params: new URLSearchParams({ status: 'open' }),
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual([{ id: 'item_1' }, { id: 'item_2' }]);
    expect(result.deliverySummary.pending_delivery_count).toBe(3);
  });

  it('caps page size to the cursor API maximum', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        hasMore: false,
      }),
    });

    await fetchAllCursorPages({
      path: '/api/example',
      orgId: 'org_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      limit: CURSOR_PAGE_LIMIT + 50,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`limit=${CURSOR_PAGE_LIMIT}`),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
      }),
    );
  });
});
