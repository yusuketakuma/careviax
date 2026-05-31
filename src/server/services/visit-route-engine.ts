import { createRoadTravelEstimator, type RouteTravelMode } from './road-routing';
import { readJsonObject } from '@/lib/db/json';

export type VisitRouteTravelMode = RouteTravelMode;

export type VisitRouteWaypoint = {
  scheduleId: string;
  patientName: string;
  address: string;
  lat: number;
  lng: number;
  priority?: string | null;
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

type NormalizedGoogleRoute = {
  duration?: string;
  distanceMeters?: number;
  optimizedIntermediateWaypointIndex?: number[];
  polyline?: {
    encodedPolyline?: string;
  };
  legs?: GoogleRouteLeg[];
};

function parseDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(value);
  if (!match) return null;
  return Math.round(Number.parseFloat(match[1]));
}

function readOptionalFiniteNumber(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalDuration(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  return parseDurationSeconds(value) === null ? null : value;
}

function readOptionalPolyline(value: unknown): NormalizedGoogleRoute['polyline'] | null {
  if (value === undefined || value === null) return undefined;
  const object = readJsonObject(value);
  if (!object) return null;
  if (object.encodedPolyline === undefined || object.encodedPolyline === null) return {};
  return typeof object.encodedPolyline === 'string'
    ? { encodedPolyline: object.encodedPolyline }
    : null;
}

function readOptimizedWaypointIndices(
  value: unknown,
  waypointCount: number,
): number[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;

  const seen = new Set<number>();
  const indices: number[] = [];
  for (const item of value) {
    if (
      typeof item !== 'number' ||
      !Number.isInteger(item) ||
      item < 0 ||
      item >= waypointCount ||
      seen.has(item)
    ) {
      return null;
    }
    seen.add(item);
    indices.push(item);
  }
  return indices;
}

function readGoogleRouteLeg(value: unknown): GoogleRouteLeg | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const duration = readOptionalDuration(object.duration);
  const distanceMeters = readOptionalFiniteNumber(object.distanceMeters);
  if (duration === null || distanceMeters === null) return null;

  return {
    ...(duration !== undefined ? { duration } : {}),
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
  };
}

function readGoogleRoute(value: unknown, waypointCount: number): NormalizedGoogleRoute | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const duration = readOptionalDuration(object.duration);
  const distanceMeters = readOptionalFiniteNumber(object.distanceMeters);
  const polyline = readOptionalPolyline(object.polyline);
  const optimizedIntermediateWaypointIndex = readOptimizedWaypointIndices(
    object.optimizedIntermediateWaypointIndex,
    waypointCount,
  );
  if (
    duration === null ||
    distanceMeters === null ||
    polyline === null ||
    optimizedIntermediateWaypointIndex === null
  ) {
    return null;
  }

  let legs: GoogleRouteLeg[] | undefined;
  if (object.legs !== undefined && object.legs !== null) {
    if (!Array.isArray(object.legs)) return null;
    legs = [];
    for (const item of object.legs) {
      const leg = readGoogleRouteLeg(item);
      if (!leg) return null;
      legs.push(leg);
    }
  }

  return {
    ...(duration !== undefined ? { duration } : {}),
    ...(distanceMeters !== undefined ? { distanceMeters } : {}),
    ...(optimizedIntermediateWaypointIndex !== undefined
      ? { optimizedIntermediateWaypointIndex }
      : {}),
    ...(polyline !== undefined ? { polyline } : {}),
    ...(legs !== undefined ? { legs } : {}),
  };
}

function readGoogleRoutes(payload: unknown, waypointCount: number): NormalizedGoogleRoute[] | null {
  const object = readJsonObject(payload);
  if (!object) return null;
  if (object.routes === undefined || object.routes === null) return [];
  if (!Array.isArray(object.routes)) return null;

  const routes: NormalizedGoogleRoute[] = [];
  for (const item of object.routes) {
    const route = readGoogleRoute(item, waypointCount);
    if (!route) return null;
    routes.push(route);
  }
  return routes;
}

function unavailableGoogleRoutePlan(args: {
  origin: VisitRouteOrigin;
  travelMode: VisitRouteTravelMode;
  waypoints: VisitRouteWaypoint[];
  note: string;
  totalDistanceMeters?: number | null;
  totalDurationSeconds?: number | null;
}): VisitRoutePlan {
  return {
    status: 'unavailable',
    note: args.note,
    travelMode: args.travelMode,
    origin: args.origin,
    encodedPath: null,
    orderedScheduleIds: args.waypoints.map((waypoint) => waypoint.scheduleId),
    totalDistanceMeters: args.totalDistanceMeters ?? null,
    totalDurationSeconds: args.totalDurationSeconds ?? null,
    stopSummaries: args.waypoints.map((waypoint, index) => ({
      scheduleId: waypoint.scheduleId,
      optimizedOrder: index + 1,
      arrivalOffsetSeconds: null,
      distanceFromPreviousMeters: null,
      durationFromPreviousSeconds: null,
    })),
  };
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

function routePriorityBonusSeconds(priority: string | null | undefined) {
  switch (priority) {
    case 'emergency':
      return 45 * 60;
    case 'urgent':
      return 25 * 60;
    default:
      return 0;
  }
}

function hasPriorityRouteConstraint(waypoints: VisitRouteWaypoint[]) {
  return waypoints.some((waypoint) => routePriorityBonusSeconds(waypoint.priority) > 0);
}

function haversineDistanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earthRadiusKm = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
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

  const payload = (await response.json()) as unknown;
  const routes = readGoogleRoutes(payload, args.waypoints.length);
  if (!routes) {
    return unavailableGoogleRoutePlan({
      origin: args.origin,
      travelMode: args.travelMode,
      waypoints: args.waypoints,
      note: 'Google Routes API のレスポンス形式が不正です',
    });
  }

  const route = routes[0];
  if (!route) {
    return unavailableGoogleRoutePlan({
      origin: args.origin,
      travelMode: args.travelMode,
      waypoints: args.waypoints,
      note: 'Google Routes API からルートが返りませんでした',
    });
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
    .filter((waypoint) => !Number.isFinite(waypoint.lat) || !Number.isFinite(waypoint.lng))
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
    () => new Array<{ meters: number; seconds: number } | null>(n).fill(null),
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
    }),
  );

  // waypoint node index in `nodes` array = waypointIndex + 1 (0 is origin)
  const remaining = args.waypoints.map((_, idx) => idx); // indices into args.waypoints
  const ordered: number[] = [];
  const stopSummaries: VisitRoutePlan['stopSummaries'] = [];
  let currentNodeIndex = 0; // origin
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  const usesPriorityConstraint = hasPriorityRouteConstraint(args.waypoints);

  while (remaining.length > 0) {
    let bestRemIdx = 0;
    let bestScoreSeconds = Number.POSITIVE_INFINITY;
    let bestDistanceMeters = Number.POSITIVE_INFINITY;
    let bestDurationSeconds = Number.POSITIVE_INFINITY;

    for (let remIdx = 0; remIdx < remaining.length; remIdx++) {
      const waypointIdx = remaining[remIdx];
      const targetNodeIndex = waypointIdx + 1;
      const cell = matrix[currentNodeIndex][targetNodeIndex];

      const distanceMeters = cell ? cell.meters : Number.POSITIVE_INFINITY;
      const durationSeconds = cell ? cell.seconds : Number.POSITIVE_INFINITY;
      const scoreSeconds =
        durationSeconds - routePriorityBonusSeconds(args.waypoints[waypointIdx].priority);

      // Guard: never let NaN participate in comparisons (Fix #1 defence-in-depth)
      if (!Number.isFinite(durationSeconds) && !Number.isFinite(distanceMeters)) {
        continue;
      }

      if (
        scoreSeconds < bestScoreSeconds ||
        (scoreSeconds === bestScoreSeconds && durationSeconds < bestDurationSeconds) ||
        (scoreSeconds === bestScoreSeconds &&
          durationSeconds === bestDurationSeconds &&
          distanceMeters < bestDistanceMeters)
      ) {
        bestRemIdx = remIdx;
        bestScoreSeconds = scoreSeconds;
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
    note: usesPriorityConstraint
      ? '優先度補正を含むヒューリスティック順序を表示しています'
      : 'ヒューリスティック順序を表示しています',
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
  if (providerName === 'google' && googleApiKey && !hasPriorityRouteConstraint(args.waypoints)) {
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
