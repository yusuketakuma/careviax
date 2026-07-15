import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  CURSOR_PAGINATION_PAGE_LIMIT,
  fetchAllCursorPages,
  fetchCursorPage,
} from './cursor-pagination-client';
import { jsonResponse } from '@/test/fetch-test-utils';

describe('cursor-pagination-client', () => {
  it('fetches exactly one bounded cursor page for incremental consumers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'row_101' }],
        meta: { limit: 100, has_more: true, next_cursor: 'cursor_200' },
      }),
    );

    const payload = await fetchCursorPage<{ id: string }>({
      path: '/api/example',
      params: new URLSearchParams('status=pending&cursor=stale'),
      cursor: 'cursor_100',
      errorMessage: 'failed',
      fetchImpl,
      limit: 101,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/example?status=pending&cursor=cursor_100&limit=100',
      undefined,
    );
    expect(payload).toEqual({
      data: [{ id: 'row_101' }],
      hasMore: true,
      nextCursor: 'cursor_200',
    });
  });

  it('follows meta.next_cursor and aggregates current cursor pages', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'row_1' }],
          meta: { limit: 1, has_more: true, next_cursor: 'cursor_1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'row_2' }],
          meta: { limit: 1, has_more: false, next_cursor: null },
        }),
      );

    const payload = await fetchAllCursorPages<{ id: string }>({
      path: '/api/example',
      errorMessage: 'failed',
      fetchImpl,
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/example?limit=1&cursor=cursor_1');
    expect(payload.data).toEqual([{ id: 'row_1' }, { id: 'row_2' }]);
    expect(payload.hasMore).toBe(false);
    expect(payload.nextCursor).toBeUndefined();
  });

  it('caps page size to the shared maximum', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        meta: { has_more: false, next_cursor: null },
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

  it('floors page size to one when a caller passes a non-positive limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        meta: { has_more: false, next_cursor: null },
      }),
    );

    await fetchAllCursorPages({
      path: '/api/example',
      errorMessage: 'failed',
      fetchImpl,
      limit: 0,
    });

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('limit=1'), undefined);
  });

  it('throws the caller error when a cursor page has malformed shape', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: { id: 'not-array' },
        meta: { has_more: true, next_cursor: 'cursor_1' },
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

  it('throws instead of truncating when a page reports has_more without a next cursor', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'row_1' }],
        meta: { has_more: true, next_cursor: null },
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

  it('throws the caller error when an item schema rejects a cursor page row', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: 123 }],
        meta: { has_more: false, next_cursor: null },
      }),
    );

    await expect(
      fetchAllCursorPages({
        path: '/api/example',
        errorMessage: 'failed',
        fetchImpl,
        itemSchema: z.object({ id: z.string() }),
      }),
    ).rejects.toThrow('failed');
  });

  it('throws the caller error when a cursor page response is not valid JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{bad json', {
        headers: { 'content-type': 'application/json' },
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

  it('normalizes non-finite max page counts to the default page cap', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'row_1' }],
        meta: { has_more: false, next_cursor: null },
      }),
    );

    const payload = await fetchAllCursorPages<{ id: string }>({
      path: '/api/example',
      errorMessage: 'failed',
      fetchImpl,
      maxPages: Number.NaN,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(payload.data).toEqual([{ id: 'row_1' }]);
  });

  it('keeps hasMore and nextCursor when the max page cap is exhausted', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'row_1' }],
          meta: { has_more: true, next_cursor: 'cursor_1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'row_2' }],
          meta: { has_more: true, next_cursor: 'cursor_2' },
        }),
      );

    const payload = await fetchAllCursorPages<{ id: string }>({
      path: '/api/example',
      errorMessage: 'failed',
      fetchImpl,
      maxPages: 2,
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(payload.data).toEqual([{ id: 'row_1' }, { id: 'row_2' }]);
    expect(payload.hasMore).toBe(true);
    expect(payload.nextCursor).toBe('cursor_2');
  });

  it('rejects a cursor cycle instead of repeating pages until the page cap', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'row_1' }],
          meta: { has_more: true, next_cursor: 'cursor_1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'row_2' }],
          meta: { has_more: true, next_cursor: 'cursor_1' },
        }),
      );

    await expect(
      fetchAllCursorPages({
        path: '/api/example',
        errorMessage: 'failed',
        fetchImpl,
      }),
    ).rejects.toThrow('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects meta cursor pages that expose next_cursor when has_more is false', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'row_1' }],
        meta: {
          has_more: false,
          next_cursor: 'cursor_1',
        },
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

  it('rejects legacy root cursor fields for meta cursor consumers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'row_1' }],
        hasMore: false,
        nextCursor: null,
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
