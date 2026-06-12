import type { VisitRouteTravelMode } from '@/types/visit-route';

export const VISIT_ROUTE_TRAVEL_MODE_LABELS: Record<VisitRouteTravelMode, string> = {
  DRIVE: '車',
  BICYCLE: '自転車',
  WALK: '徒歩',
  TWO_WHEELER: '二輪',
};

export const VISIT_ROUTE_TRAVEL_MODE_OPTIONS = (
  Object.entries(VISIT_ROUTE_TRAVEL_MODE_LABELS) as Array<[VisitRouteTravelMode, string]>
).map(([value, label]) => ({ value, label }));
