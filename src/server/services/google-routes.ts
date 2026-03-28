export type VisitRouteTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

export type VisitRouteWaypoint = {
  scheduleId: string;
  patientName: string;
  address: string;
  lat: number;
  lng: number;
};

export type VisitRouteOrigin = {
  lat: number;
  lng: number;
  label: string;
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
  stopSummaries: Array<{
    scheduleId: string;
    optimizedOrder: number;
    arrivalOffsetSeconds: number | null;
    distanceFromPreviousMeters: number | null;
    durationFromPreviousSeconds: number | null;
  }>;
};

type GoogleRouteLeg = {
  duration?: string;
  distanceMeters?: number;
};

type GoogleRouteResponse = {
  routes?: Array<{
    duration?: string;
    distanceMeters?: number;
    optimizedIntermediateWaypointIndex?: number[];
    polyline?: {
      encodedPolyline?: string;
    };
    legs?: GoogleRouteLeg[];
  }>;
};

function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(value);
  if (!match) return null;
  return Math.round(Number.parseFloat(match[1]));
}

function resolveGoogleMapsServerApiKey() {
  return (
    process.env.GOOGLE_MAPS_SERVER_API_KEY ??
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    null
  );
}

export async function computeOptimizedVisitRoute(args: {
  origin: VisitRouteOrigin | null;
  travelMode: VisitRouteTravelMode;
  waypoints: VisitRouteWaypoint[];
}): Promise<VisitRoutePlan> {
  const orderedScheduleIds = args.waypoints.map((waypoint) => waypoint.scheduleId);

  if (args.waypoints.length === 0) {
    return {
      status: 'unavailable',
      note: '対象の訪問予定がありません',
      travelMode: args.travelMode,
      origin: args.origin,
      encodedPath: null,
      orderedScheduleIds,
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      stopSummaries: [],
    };
  }

  if (!args.origin) {
    return {
      status: 'unavailable',
      note: '拠点の座標が未設定のためルート最適化を計算できません',
      travelMode: args.travelMode,
      origin: null,
      encodedPath: null,
      orderedScheduleIds,
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      stopSummaries: args.waypoints.map((waypoint, index) => ({
        scheduleId: waypoint.scheduleId,
        optimizedOrder: index + 1,
        arrivalOffsetSeconds: null,
        distanceFromPreviousMeters: null,
        durationFromPreviousSeconds: null,
      })),
    };
  }

  const apiKey = resolveGoogleMapsServerApiKey();
  if (!apiKey) {
    return {
      status: 'unavailable',
      note: 'Google Maps API key が未設定のためルート最適化を計算できません',
      travelMode: args.travelMode,
      origin: args.origin,
      encodedPath: null,
      orderedScheduleIds,
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      stopSummaries: args.waypoints.map((waypoint, index) => ({
        scheduleId: waypoint.scheduleId,
        optimizedOrder: index + 1,
        arrivalOffsetSeconds: null,
        distanceFromPreviousMeters: null,
        durationFromPreviousSeconds: null,
      })),
    };
  }

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex,routes.legs.duration,routes.legs.distanceMeters',
    },
    body: JSON.stringify({
      origin: {
        location: {
          latLng: {
            latitude: args.origin.lat,
            longitude: args.origin.lng,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: args.origin.lat,
            longitude: args.origin.lng,
          },
        },
      },
      intermediates: args.waypoints.map((waypoint) => ({
        location: {
          latLng: {
            latitude: waypoint.lat,
            longitude: waypoint.lng,
          },
        },
      })),
      travelMode: args.travelMode,
      optimizeWaypointOrder: args.waypoints.length > 1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || 'Google Routes API request failed');
  }

  const payload = (await response.json()) as GoogleRouteResponse;
  const route = payload.routes?.[0];
  if (!route) {
    return {
      status: 'unavailable',
      note: 'Google Routes API からルートが返りませんでした',
      travelMode: args.travelMode,
      origin: args.origin,
      encodedPath: null,
      orderedScheduleIds,
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      stopSummaries: args.waypoints.map((waypoint, index) => ({
        scheduleId: waypoint.scheduleId,
        optimizedOrder: index + 1,
        arrivalOffsetSeconds: null,
        distanceFromPreviousMeters: null,
        durationFromPreviousSeconds: null,
      })),
    };
  }

  const optimizedIndices =
    route.optimizedIntermediateWaypointIndex?.length === args.waypoints.length
      ? route.optimizedIntermediateWaypointIndex
      : args.waypoints.map((_, index) => index);
  const optimizedWaypoints = optimizedIndices.map((index) => args.waypoints[index]);

  let cumulativeDuration = 0;
  const stopSummaries = optimizedWaypoints.map((waypoint, index) => {
    const leg = route.legs?.[index];
    const legDurationSeconds = parseDurationSeconds(leg?.duration);
    if (legDurationSeconds != null) {
      cumulativeDuration += legDurationSeconds;
    }

    return {
      scheduleId: waypoint.scheduleId,
      optimizedOrder: index + 1,
      arrivalOffsetSeconds: legDurationSeconds == null ? null : cumulativeDuration,
      distanceFromPreviousMeters: leg?.distanceMeters ?? null,
      durationFromPreviousSeconds: legDurationSeconds,
    };
  });

  return {
    status: 'ok',
    note: null,
    travelMode: args.travelMode,
    origin: args.origin,
    encodedPath: route.polyline?.encodedPolyline ?? null,
    orderedScheduleIds: optimizedWaypoints.map((waypoint) => waypoint.scheduleId),
    totalDistanceMeters: route.distanceMeters ?? null,
    totalDurationSeconds: parseDurationSeconds(route.duration),
    stopSummaries,
  };
}
