export type VisitRouteTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

export type VisitRouteOrigin = {
  lat: number;
  lng: number;
  label: string;
};

export type VisitRouteStopSummary = {
  scheduleId: string;
  optimizedOrder: number;
  arrivalOffsetSeconds: number | null;
  distanceFromPreviousMeters: number | null;
  durationFromPreviousSeconds: number | null;
};

export type VisitRoutePlan = {
  status: 'ok' | 'unavailable';
  note: string | null;
  travelMode: VisitRouteTravelMode;
  origin: VisitRouteOrigin | null;
  encodedPath: string | null;
  orderedScheduleIds: string[];
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  stopSummaries: VisitRouteStopSummary[];
};
