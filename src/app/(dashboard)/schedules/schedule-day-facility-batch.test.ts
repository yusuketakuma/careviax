import { describe, expect, it, vi } from 'vitest';
import {
  buildScheduleDayFacilityBatchPayload,
  handleScheduleDayFacilityBatchSuccess,
  saveScheduleDayFacilityBatch,
} from './schedule-day-facility-batch';
import type { FacilityTrackerGroup } from './schedule-day-view.helpers';

const facilityGroup: FacilityTrackerGroup = {
  key: 'facility:tokyo:unit-a',
  batchId: null,
  label: '東京ホーム 2階',
  siteName: '中央薬局',
  patientNames: ['患者A', '患者B', '患者C'],
  scheduleIds: ['schedule_a', 'schedule_b', 'schedule_c'],
  patients: [
    {
      scheduleId: 'schedule_a',
      patientName: '患者A',
      unitName: '201',
      routeOrder: 2,
    },
    {
      scheduleId: 'schedule_b',
      patientName: '患者B',
      unitName: '101',
      routeOrder: 1,
    },
    {
      scheduleId: 'schedule_c',
      patientName: '患者C',
      unitName: '301',
      routeOrder: null,
    },
  ],
  preparedCount: 1,
  carryPendingCount: 2,
  incompleteCount: 3,
  routeOrders: [2, 1],
};

describe('schedule day facility batch helpers', () => {
  it('builds the facility batch payload using route overrides before defaults', () => {
    expect(
      buildScheduleDayFacilityBatchPayload({
        group: facilityGroup,
        facilityRouteDefaults: {
          [facilityGroup.key]: {
            schedule_a: '2',
            schedule_b: '1',
            schedule_c: '3',
          },
        },
        facilityRouteOverrides: {
          [facilityGroup.key]: {
            schedule_a: '3',
            schedule_c: '2',
          },
        },
        carryItemsConfirmed: true,
      }),
    ).toEqual({
      schedule_ids: ['schedule_a', 'schedule_b', 'schedule_c'],
      ordered_schedule_ids: ['schedule_b', 'schedule_c', 'schedule_a'],
      carry_items_confirmed: true,
      allow_mixed_unit: true,
    });
  });

  it('posts the facility batch payload with org scope', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { id: 'batch_1' } }));

    await expect(
      saveScheduleDayFacilityBatch({
        orgId: 'org_1',
        groupKey: facilityGroup.key,
        facilityTracker: [facilityGroup],
        facilityRouteDefaults: {
          [facilityGroup.key]: {
            schedule_a: '2',
            schedule_b: '1',
            schedule_c: '3',
          },
        },
        facilityRouteOverrides: {},
        carryItemsConfirmed: false,
        fetchImpl,
      }),
    ).resolves.toEqual({ data: { id: 'batch_1' } });

    expect(fetchImpl).toHaveBeenCalledWith('/api/facility-visit-batches', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({
        schedule_ids: ['schedule_a', 'schedule_b', 'schedule_c'],
        ordered_schedule_ids: ['schedule_b', 'schedule_a', 'schedule_c'],
        carry_items_confirmed: false,
        allow_mixed_unit: true,
      }),
    });
  });

  it('rejects unknown facility groups before posting', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: null }));

    await expect(
      saveScheduleDayFacilityBatch({
        orgId: 'org_1',
        groupKey: 'missing',
        facilityTracker: [facilityGroup],
        facilityRouteDefaults: {},
        facilityRouteOverrides: {},
        carryItemsConfirmed: false,
        fetchImpl,
      }),
    ).rejects.toThrow('訪問先グループが見つかりません');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws the server error message when facility batch save fails', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: '施設グループが重複しています' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      saveScheduleDayFacilityBatch({
        orgId: 'org_1',
        groupKey: facilityGroup.key,
        facilityTracker: [facilityGroup],
        facilityRouteDefaults: {},
        facilityRouteOverrides: {},
        carryItemsConfirmed: false,
        fetchImpl,
      }),
    ).rejects.toThrow('施設グループが重複しています');
  });

  it('notifies success and refreshes facility-dependent queries after save', async () => {
    const notifySuccess = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);

    await handleScheduleDayFacilityBatchSuccess({
      orgId: 'org_1',
      carryItemsConfirmed: true,
      notifySuccess,
      invalidateQueries,
    });

    expect(notifySuccess).toHaveBeenCalledWith('同時訪問グループの順序と持参確認を保存しました');
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['visit-schedules', 'week-board', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['dashboard-workflow', 'org_1'],
    });
  });
});
