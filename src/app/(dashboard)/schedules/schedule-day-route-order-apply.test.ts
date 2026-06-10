import { describe, expect, it, vi } from 'vitest';
import {
  applyScheduleDayRouteOrderDraft,
  buildScheduleDayRouteOrderUpdates,
  handleScheduleDayRouteOrderApplySuccess,
} from './schedule-day-route-order-apply';

describe('schedule day route order apply helpers', () => {
  it('builds one-based route order updates from the draft order', () => {
    expect(buildScheduleDayRouteOrderUpdates(['schedule_b', 'schedule_a', 'schedule_c'])).toEqual([
      { scheduleId: 'schedule_b', route_order: 1 },
      { scheduleId: 'schedule_a', route_order: 2 },
      { scheduleId: 'schedule_c', route_order: 3 },
    ]);
  });

  it('applies draft order through the visit schedule route client', async () => {
    const applyRouteUpdates = vi.fn(async () => ({ ok: true }));

    await expect(
      applyScheduleDayRouteOrderDraft({
        orgId: 'org_1',
        hasRoutePlan: true,
        draftScheduleIds: ['schedule_2', 'schedule_1'],
        applyRouteUpdates,
      }),
    ).resolves.toEqual({ ok: true });

    expect(applyRouteUpdates).toHaveBeenCalledWith({
      orgId: 'org_1',
      updates: [
        { scheduleId: 'schedule_2', route_order: 1 },
        { scheduleId: 'schedule_1', route_order: 2 },
      ],
    });
  });

  it('rejects empty drafts and missing route plans before calling the route client', async () => {
    const applyRouteUpdates = vi.fn(async () => ({ ok: true }));

    await expect(
      applyScheduleDayRouteOrderDraft({
        orgId: 'org_1',
        hasRoutePlan: false,
        draftScheduleIds: ['schedule_1'],
        applyRouteUpdates,
      }),
    ).rejects.toThrow('反映できる最適ルートがありません');

    await expect(
      applyScheduleDayRouteOrderDraft({
        orgId: 'org_1',
        hasRoutePlan: true,
        draftScheduleIds: [],
        applyRouteUpdates,
      }),
    ).rejects.toThrow('反映できる最適ルートがありません');

    expect(applyRouteUpdates).not.toHaveBeenCalled();
  });

  it('notifies success and refreshes route-order dependent queries after apply', async () => {
    const notifySuccess = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);

    await handleScheduleDayRouteOrderApplySuccess({
      orgId: 'org_1',
      notifySuccess,
      invalidateQueries,
    });

    expect(notifySuccess).toHaveBeenCalledWith(
      'Google Routes API の順序を route_order に反映しました',
    );
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['visit-schedules', 'week-board', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['visit-route-plan', 'org_1'],
    });
  });
});
