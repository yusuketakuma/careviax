import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyMixedVisitRouteUpdates,
  applyVisitScheduleProposalRouteUpdates,
  applyVisitScheduleRouteUpdates,
} from './visit-route-client';

const legacyCases = [
  {
    label: 'schedule reorder',
    endpoint: '/api/visit-schedules/reorder',
    failureMessage: '訪問予定の順路更新に失敗しました',
    invoke: () =>
      applyVisitScheduleRouteUpdates({
        orgId: 'org_1',
        updates: [{ scheduleId: 'schedule_1', route_order: 1 }],
      }),
  },
  {
    label: 'mixed reorder',
    endpoint: '/api/visit-routes/reorder',
    failureMessage: '混在ルート順の更新に失敗しました',
    invoke: () =>
      applyMixedVisitRouteUpdates({
        orgId: 'org_1',
        updates: [{ item_type: 'schedule', id: 'schedule_1', route_order: 1 }],
      }),
  },
  {
    label: 'proposal reorder',
    endpoint: '/api/visit-schedule-proposals/reorder',
    failureMessage: '訪問候補の順路更新に失敗しました',
    invoke: () =>
      applyVisitScheduleProposalRouteUpdates({
        orgId: 'org_1',
        routeOrderUpdates: [{ proposal_id: 'proposal_1', route_order: 1 }],
      }),
  },
] as const;

describe('visit route acknowledgement readers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(legacyCases)('rejects a legacy successful $label response', async (testCase) => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ message: '順路を更新しました' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(testCase.invoke()).rejects.toThrow(testCase.failureMessage);
    expect(fetchMock).toHaveBeenCalledWith(
      testCase.endpoint,
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
