import { describe, expect, it, vi } from 'vitest';
import { CURSOR_PAGINATION_PAGE_LIMIT, fetchAllCursorPages } from './cursor-pagination-client';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

describe('cursor-pagination-client', () => {
  it('follows nextCursor and preserves first-page metadata', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'row_1' }],
          hasMore: true,
          nextCursor: 'cursor_1',
          deliverySummary: { pending_delivery_count: 2 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'row_2' }],
          hasMore: false,
          deliverySummary: { pending_delivery_count: 99 },
        }),
      );

    const payload = await fetchAllCursorPages<
      { id: string },
      {
        data: Array<{ id: string }>;
        hasMore: boolean;
        nextCursor?: string;
        deliverySummary: { pending_delivery_count: number };
      }
    >({
      path: '/api/example',
      errorMessage: 'failed',
      fetchImpl,
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(payload.data).toEqual([{ id: 'row_1' }, { id: 'row_2' }]);
    expect(payload.deliverySummary.pending_delivery_count).toBe(2);
    expect(payload.hasMore).toBe(false);
    expect(payload.nextCursor).toBeUndefined();
  });

  it('caps page size to the shared maximum', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        hasMore: false,
      }),
    );

    await fetchAllCursorPages({
      path: '/api/example',
      errorMessage: 'failed',
      fetchImpl,
      limit: CURSOR_PAGINATION_PAGE_LIMIT + 50,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`limit=${CURSOR_PAGINATION_PAGE_LIMIT}`),
      undefined,
    );
  });

  it('throws the caller error when a cursor page has malformed shape', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: { id: 'not-array' },
        hasMore: true,
        nextCursor: 123,
      }),
    );

    await expect(
      fetchAllCursorPages({
        path: '/api/example',
        errorMessage: 'failed',
        fetchImpl,
      }),
    ).rejects.toThrow('failed');
  });
});
