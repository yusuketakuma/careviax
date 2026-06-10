import { buildOrderedFacilityScheduleIds } from './calendar-view.helpers';
import type { FacilityTrackerGroup } from './schedule-day-view.helpers';

type FetchLike = typeof fetch;

type QueryInvalidator = (filters: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;

export type ScheduleDayFacilityRouteDrafts = Record<string, Record<string, string>>;

export type ScheduleDayFacilityBatchPayload = {
  schedule_ids: string[];
  ordered_schedule_ids: string[];
  carry_items_confirmed: boolean;
  allow_mixed_unit: true;
};

export function buildScheduleDayFacilityBatchPayload({
  group,
  facilityRouteDefaults,
  facilityRouteOverrides,
  carryItemsConfirmed,
}: {
  group: FacilityTrackerGroup;
  facilityRouteDefaults: ScheduleDayFacilityRouteDrafts;
  facilityRouteOverrides: ScheduleDayFacilityRouteDrafts;
  carryItemsConfirmed: boolean;
}): ScheduleDayFacilityBatchPayload {
  const routeDraft = {
    ...(facilityRouteDefaults[group.key] ?? {}),
    ...(facilityRouteOverrides[group.key] ?? {}),
  };

  return {
    schedule_ids: group.scheduleIds,
    ordered_schedule_ids: buildOrderedFacilityScheduleIds(group, routeDraft),
    carry_items_confirmed: carryItemsConfirmed,
    allow_mixed_unit: true,
  };
}

export async function saveScheduleDayFacilityBatch({
  orgId,
  groupKey,
  facilityTracker,
  facilityRouteDefaults,
  facilityRouteOverrides,
  carryItemsConfirmed,
  fetchImpl = fetch,
}: {
  orgId: string;
  groupKey: string;
  facilityTracker: FacilityTrackerGroup[];
  facilityRouteDefaults: ScheduleDayFacilityRouteDrafts;
  facilityRouteOverrides: ScheduleDayFacilityRouteDrafts;
  carryItemsConfirmed: boolean;
  fetchImpl?: FetchLike;
}) {
  const group = facilityTracker.find((candidate) => candidate.key === groupKey);
  if (!group) {
    throw new Error('訪問先グループが見つかりません');
  }

  const res = await fetchImpl('/api/facility-visit-batches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify(
      buildScheduleDayFacilityBatchPayload({
        group,
        facilityRouteDefaults,
        facilityRouteOverrides,
        carryItemsConfirmed,
      }),
    ),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(
      typeof error.message === 'string' ? error.message : '同時訪問グループの保存に失敗しました',
    );
  }

  return res.json();
}

export async function handleScheduleDayFacilityBatchSuccess({
  orgId,
  carryItemsConfirmed,
  notifySuccess,
  invalidateQueries,
}: {
  orgId: string;
  carryItemsConfirmed: boolean;
  notifySuccess: (message: string) => void;
  invalidateQueries: QueryInvalidator;
}) {
  notifySuccess(
    carryItemsConfirmed
      ? '同時訪問グループの順序と持参確認を保存しました'
      : '同時訪問グループの順序を保存しました',
  );
  await Promise.all([
    invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
    invalidateQueries({ queryKey: ['dashboard-workflow', orgId] }),
  ]);
}
