export type VisitRouteTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
export type VisitRouteLegDistanceSource = 'road' | 'straight_line';
export type VisitRouteDistanceSource = VisitRouteLegDistanceSource | 'mixed';
export type VisitRouteTimeWindow = {
  from: string;
  to: string;
};

export type VisitRouteOrigin = {
  lat: number;
  lng: number;
  label: string;
};

export type VisitRouteWaypoint = {
  scheduleId: string;
  patientName: string;
  address: string;
  lat: number;
  lng: number;
  priority?: string | null;
  timeWindow?: VisitRouteTimeWindow | null;
  serviceMinutes?: number | null;
};

export type VisitRouteStopSummary = {
  scheduleId: string;
  optimizedOrder: number;
  arrivalOffsetSeconds: number | null;
  distanceFromPreviousMeters: number | null;
  durationFromPreviousSeconds: number | null;
  distanceSource?: VisitRouteLegDistanceSource | null;
  serviceDurationSeconds?: number | null;
  timeWindow?: VisitRouteTimeWindow | null;
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
  distanceSource?: VisitRouteDistanceSource | null;
  stopSummaries: VisitRouteStopSummary[];
};
