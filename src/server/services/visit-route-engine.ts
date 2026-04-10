import { createRoadTravelEstimator, type RouteTravelMode } from './road-routing';

export type VisitRouteTravelMode = RouteTravelMode;

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

function localSpeedKph(travelMode: VisitRouteTravelMode) {
  switch (travelMode) {
    case 'WALK':
      return 4;
    case 'BICYCLE':
      return 14;
    case 'TWO_WHEELER':
      return 28;
    default:
      return 30;
  }
}

function haversineDistanceKm(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) {
  const earthRadiusKm = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

async function computeGoogleWaypointRoute(args: {
  origin: VisitRouteOrigin;
  travelMode: VisitRouteTravelMode;
  waypoints: VisitRouteWaypoint[];
  apiKey: string;
}): Promise<VisitRoutePlan> {
  let response: Response;
  try {
    response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      signal: AbortSignal.timeout(Number(process.env.ROUTING_API_TIMEOUT_MS ?? 5000)),
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': args.apiKey,
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
      cache: 'no-store',
    });
  } catch (error) {
    const isTimeout =
      (error as { name?: string })?.name === 'TimeoutError' ||
      (error as { name?: string })?.name === 'AbortError';
    if (isTimeout) {
      return {
        status: 'unavailable',
        note: 'timeout',
        travelMode: args.travelMode,
        origin: args.origin,
        encodedPath: null,
        orderedScheduleIds: args.waypoints.map((waypoint) => waypoint.scheduleId),
        totalDistanceMeters: null,
        totalDurationSeconds: null,
        stopSummaries: [],
      };
    }
    throw error;
  }

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
      orderedScheduleIds: args.waypoints.map((waypoint) => waypoint.scheduleId),
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

  const rawIndices = route.optimizedIntermediateWaypointIndex;
  if (rawIndices !== undefined && rawIndices.length !== args.waypoints.length) {
    return {
      status: 'unavailable',
      note: 'waypoint_order_length_mismatch',
      travelMode: args.travelMode,
      origin: args.origin,
      encodedPath: null,
      orderedScheduleIds: args.waypoints.map((waypoint) => waypoint.scheduleId),
      totalDistanceMeters: route.distanceMeters ?? null,
      totalDurationSeconds: parseDurationSeconds(route.duration),
      stopSummaries: [],
    };
  }
  const optimizedIndices =
    rawIndices?.length === args.waypoints.length
      ? rawIndices
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

async function computeHeuristicRoute(args: {
  origin: VisitRouteOrigin;
  travelMode: VisitRouteTravelMode;
  waypoints: VisitRouteWaypoint[];
}): Promise<VisitRoutePlan> {
  // Fix #1: validate geocodes before doing any computation
  const missingGeocodeWaypointIds = args.waypoints
    .filter(
      (waypoint) =>
        !Number.isFinite(waypoint.lat) || !Number.isFinite(waypoint.lng)
    )
    .map((waypoint) => waypoint.scheduleId);

  if (missingGeocodeWaypointIds.length > 0) {
    return {
      status: 'unavailable',
      note: 'missing_geocode',
      travelMode: args.travelMode,
      origin: args.origin,
      encodedPath: null,
      orderedScheduleIds: args.waypoints.map((waypoint) => waypoint.scheduleId),
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      stopSummaries: [],
      missingGeocodeWaypointIds,
    } as VisitRoutePlan & { missingGeocodeWaypointIds: string[] };
  }

  if (args.waypoints.length === 0) {
    return {
      status: 'ok',
      note: 'ヒューリスティック順序を表示しています',
      travelMode: args.travelMode,
      origin: args.origin,
      encodedPath: null,
      orderedScheduleIds: [],
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      stopSummaries: [],
    };
  }

  const estimateRoadTravel = createRoadTravelEstimator(args.travelMode);

  // Fix #8: all nodes in order: [origin, waypoint_0, waypoint_1, ...]
  // Build all unique (from, to) pairs and fetch in parallel
  type NodePoint = { lat: number; lng: number };
  const nodes: NodePoint[] = [
    { lat: args.origin.lat, lng: args.origin.lng },
    ...args.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
  ];
  const n = nodes.length;

  // matrix[i][j] = { meters, seconds } | null, i !== j
  const matrix: Array<Array<{ meters: number; seconds: number } | null>> = Array.from(
    { length: n },
    () => new Array<{ meters: number; seconds: number } | null>(n).fill(null)
  );

  const pairs: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) pairs.push({ i, j });
    }
  }

  await Promise.all(
    pairs.map(async ({ i, j }) => {
      const estimate = await estimateRoadTravel(nodes[i], nodes[j]);
      if (estimate) {
        matrix[i][j] = {
          meters: estimate.distanceKm * 1000,
          seconds: Math.round(estimate.durationMinutes * 60),
        };
      } else {
        const distKm = haversineDistanceKm(nodes[i], nodes[j]);
        if (Number.isFinite(distKm)) {
          const meters = distKm * 1000;
          const seconds = Math.round((meters / 1000 / localSpeedKph(args.travelMode)) * 3600);
          matrix[i][j] = { meters, seconds };
        }
        // else: matrix[i][j] stays null (unreachable pair)
      }
    })
  );

  // waypoint node index in `nodes` array = waypointIndex + 1 (0 is origin)
  const remaining = args.waypoints.map((_, idx) => idx); // indices into args.waypoints
  const ordered: number[] = [];
  const stopSummaries: VisitRoutePlan['stopSummaries'] = [];
  let currentNodeIndex = 0; // origin
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  while (remaining.length > 0) {
    let bestRemIdx = 0;
    let bestDistanceMeters = Number.POSITIVE_INFINITY;
    let bestDurationSeconds = Number.POSITIVE_INFINITY;

    for (let remIdx = 0; remIdx < remaining.length; remIdx++) {
      const waypointIdx = remaining[remIdx];
      const targetNodeIndex = waypointIdx + 1;
      const cell = matrix[currentNodeIndex][targetNodeIndex];

      const distanceMeters = cell ? cell.meters : Number.POSITIVE_INFINITY;
      const durationSeconds = cell ? cell.seconds : Number.POSITIVE_INFINITY;

      // Guard: never let NaN participate in comparisons (Fix #1 defence-in-depth)
      if (!Number.isFinite(durationSeconds) && !Number.isFinite(distanceMeters)) {
        continue;
      }

      if (
        durationSeconds < bestDurationSeconds ||
        (durationSeconds === bestDurationSeconds && distanceMeters < bestDistanceMeters)
      ) {
        bestRemIdx = remIdx;
        bestDistanceMeters = distanceMeters;
        bestDurationSeconds = durationSeconds;
      }
    }

    const [nextWaypointIdx] = remaining.splice(bestRemIdx, 1);
    ordered.push(nextWaypointIdx);
    const nextWaypoint = args.waypoints[nextWaypointIdx];
    totalDistanceMeters += Number.isFinite(bestDistanceMeters) ? Math.round(bestDistanceMeters) : 0;
    totalDurationSeconds += Number.isFinite(bestDurationSeconds) ? bestDurationSeconds : 0;
    stopSummaries.push({
      scheduleId: nextWaypoint.scheduleId,
      optimizedOrder: ordered.length,
      arrivalOffsetSeconds: totalDurationSeconds,
      distanceFromPreviousMeters: Number.isFinite(bestDistanceMeters)
        ? Math.round(bestDistanceMeters)
        : null,
      durationFromPreviousSeconds: Number.isFinite(bestDurationSeconds)
        ? bestDurationSeconds
        : null,
    });
    currentNodeIndex = nextWaypointIdx + 1;
  }

  return {
    status: 'ok',
    note: 'ヒューリスティック順序を表示しています',
    travelMode: args.travelMode,
    origin: args.origin,
    encodedPath: null,
    orderedScheduleIds: ordered.map((idx) => args.waypoints[idx].scheduleId),
    totalDistanceMeters,
    totalDurationSeconds,
    stopSummaries,
  };
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

  const providerName = process.env.ROUTING_API_PROVIDER ?? 'osrm';
  const googleApiKey = resolveGoogleMapsServerApiKey();
  if (providerName === 'google' && googleApiKey) {
    return computeGoogleWaypointRoute({
      origin: args.origin,
      travelMode: args.travelMode,
      waypoints: args.waypoints,
      apiKey: googleApiKey,
    });
  }

  return computeHeuristicRoute({
    origin: args.origin,
    travelMode: args.travelMode,
    waypoints: args.waypoints,
  });
}
