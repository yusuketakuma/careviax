import {
  applyVisitScheduleRouteUpdates,
  type VisitRouteConfirmationContext,
  type VisitScheduleRouteUpdate,
} from './visit-route-client';

type ApplyRouteUpdates = typeof applyVisitScheduleRouteUpdates;

type QueryInvalidator = (filters: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;

export function buildScheduleDayRouteOrderUpdates(
  draftScheduleIds: string[],
): VisitScheduleRouteUpdate[] {
  return draftScheduleIds.map((scheduleId, index) => ({
    scheduleId,
    route_order: index + 1,
  }));
}

export async function applyScheduleDayRouteOrderDraft({
  orgId,
  hasRoutePlan,
  draftScheduleIds,
  confirmationContext,
  applyRouteUpdates = applyVisitScheduleRouteUpdates,
}: {
  orgId: string;
  hasRoutePlan: boolean;
  draftScheduleIds: string[];
  confirmationContext?: VisitRouteConfirmationContext;
  applyRouteUpdates?: ApplyRouteUpdates;
}) {
  if (!hasRoutePlan || draftScheduleIds.length === 0) {
    throw new Error('反映できる最適ルートがありません');
  }

  return applyRouteUpdates({
    orgId,
    updates: buildScheduleDayRouteOrderUpdates(draftScheduleIds),
    ...(confirmationContext ? { confirmationContext } : {}),
  });
}

export async function handleScheduleDayRouteOrderApplySuccess({
  orgId,
  notifySuccess,
  invalidateQueries,
}: {
  orgId: string;
  notifySuccess: (message: string) => void;
  invalidateQueries: QueryInvalidator;
}) {
  notifySuccess('Google Routes API の順序を route_order に反映しました');
  await Promise.all([
    invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
    invalidateQueries({ queryKey: ['visit-route-plan', orgId] }),
  ]);
}
