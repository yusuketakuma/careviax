import { describe, expect, it, vi } from 'vitest';
import {
  fetchVisitSchedulesWindow,
  VISIT_SCHEDULE_PAGE_LIMIT,
} from './visit-schedule-fetch.helpers';

describe('visit-schedule-fetch.helpers', () => {
  it('collects paginated schedules until all pages are fetched', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'schedule_1' }],
          hasMore: true,
          nextCursor: 'cursor_1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'schedule_2' }],
          hasMore: false,
        }),
      });

    const schedules = await fetchVisitSchedulesWindow<{ id: string }>({
      orgId: 'org_1',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      limit: 1,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(schedules).toEqual([{ id: 'schedule_1' }, { id: 'schedule_2' }]);
  });

  it('caps the request limit to the API maximum', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        hasMore: false,
      }),
    });

    await fetchVisitSchedulesWindow({
      orgId: 'org_1',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      limit: VISIT_SCHEDULE_PAGE_LIMIT + 50,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`limit=${VISIT_SCHEDULE_PAGE_LIMIT}`),
      expect.any(Object),
    );
  });
});
