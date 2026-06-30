import { readJsonResponseBody } from '@/lib/api/response-body';
import { readJsonObject } from '@/lib/db/json';
import { mapWithConcurrency, normalizeConcurrencyLimit } from '@/lib/utils/concurrency';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import type { VisitRouteOrigin, VisitRoutePlan, VisitRouteTravelMode } from '@/types/visit-route';
import { createFetchTimeout } from './fetch-timeout';
import {
  createRoadTravelEstimator,
  estimateFallbackTravelMinutes,
  type RoadTravelEstimator,
  type TravelEstimate,
} from './road-routing';

export type { VisitRouteOrigin, VisitRoutePlan, VisitRouteTravelMode } from '@/types/visit-route';

const DEFAULT_GOOGLE_ROUTE_TIMEOUT_MS = 5000;

export type VisitRouteWaypoint = {
  scheduleId: string;
  patientName: string;
  address: string;
  lat: number;
  lng: number;
  priority?: string | null;
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

function routePriorityRank(priority: string | null | undefined) {
  switch (priority) {
    case 'emergency':
      return 0;
    case 'urgent':
      return 1;
    default:
      return 2;
  }
}

function hasPriorityRouteConstraint(waypoints: VisitRouteWaypoint[]) {
  return waypoints.some((waypoint) => routePriorityRank(waypoint.priority) < 2);
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

type RouteMatrixCell = { meters: number; seconds: number };
type RouteMatrix = Array<Array<RouteMatrixCell | null>>;
type NodePoint = { lat: number; lng: number };

const DEFAULT_ROUTE_MATRIX_PAIR_CONCURRENCY = 8;
const MAX_ROUTE_MATRIX_PAIR_CONCURRENCY = 16;

function normalizeRouteMatrixPairConcurrency(value: unknown) {
  return normalizeConcurrencyLimit(value, {
    defaultValue: DEFAULT_ROUTE_MATRIX_PAIR_CONCURRENCY,
    max: MAX_ROUTE_MATRIX_PAIR_CONCURRENCY,
  });
}

function estimateToMatrixCell(
  estimate: TravelEstimate | null,
  from: NodePoint,
  to: NodePoint,
  travelMode: VisitRouteTravelMode,
): RouteMatrixCell | null {
  if (estimate && Number.isFinite(estimate.durationMinutes)) {
    const fallbackDistanceKm = haversineDistanceKm(from, to);
    const distanceKm = Number.isFinite(estimate.distanceKm)
      ? estimate.distanceKm
      : fallbackDistanceKm;
    if (Number.isFinite(distanceKm)) {
      return {
        meters: distanceKm * 1000,
        seconds: Math.round(estimate.durationMinutes * 60),
      };
    }
  }

  const fallbackDistanceKm = haversineDistanceKm(from, to);
  if (!Number.isFinite(fallbackDistanceKm)) return null;
  const meters = fallbackDistanceKm * 1000;
  return {
    meters,
    seconds: Math.round(estimateFallbackTravelMinutes(fallbackDistanceKm, travelMode) * 60),
  };
}

async function buildRouteMatrix(args: {
  nodes: NodePoint[];
  travelMode: VisitRouteTravelMode;
  estimateRoadTravel:
    | RoadTravelEstimator
    | ((from: NodePoint, to: NodePoint) => Promise<TravelEstimate | null>);
}): Promise<RouteMatrix> {
  const matrix: RouteMatrix = Array.from({ length: args.nodes.length }, () =>
    new Array<RouteMatrixCell | null>(args.nodes.length).fill(null),
  );
  const estimateMatrix =
    'estimateMatrix' in args.estimateRoadTravel &&
    typeof args.estimateRoadTravel.estimateMatrix === 'function'
      ? await args.estimateRoadTravel.estimateMatrix(args.nodes)
      : null;

  if (estimateMatrix) {
    for (let i = 0; i < args.nodes.length; i += 1) {
      for (let j = 0; j < args.nodes.length; j += 1) {
        if (i === j) continue;
        matrix[i][j] = estimateToMatrixCell(
          estimateMatrix[i]?.[j] ?? null,
          args.nodes[i]!,
          args.nodes[j]!,
          args.travelMode,
        );
      }
    }
    return matrix;
  }

  const pairs: Array<{ i: number; j: number }> = [];
  for (let i = 0; i < args.nodes.length; i += 1) {
    for (let j = 0; j < args.nodes.length; j += 1) {
      if (i !== j) pairs.push({ i, j });
    }
  }

  await mapWithConcurrency(
    pairs,
    normalizeRouteMatrixPairConcurrency(process.env.ROUTING_API_CONCURRENCY),
    async ({ i, j }) => {
      const from = args.nodes[i]!;
      const to = args.nodes[j]!;
      const estimate = await args.estimateRoadTravel(from, to);
      matrix[i][j] = estimateToMatrixCell(estimate, from, to, args.travelMode);
    },
  );

  return matrix;
}

async function computeGoogleWaypointRoute(args: {
  origin: VisitRouteOrigin;
  travelMode: VisitRouteTravelMode;
  waypoints: VisitRouteWaypoint[];
  apiKey: string;
}): Promise<VisitRoutePlan> {
  const abort = createFetchTimeout(
    normalizePositiveTimeoutMs(process.env.ROUTING_API_TIMEOUT_MS, {
      fallbackMs: DEFAULT_GOOGLE_ROUTE_TIMEOUT_MS,
    }),
  );
  let response: Response;
  try {
    response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      signal: abort.signal,
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
      return unavailableGoogleRoutePlan({
        note: 'timeout',
        travelMode: args.travelMode,
        origin: args.origin,
        waypoints: args.waypoints,
      });
    }
    return unavailableGoogleRoutePlan({
      note: 'Google Routes API request failed',
      travelMode: args.travelMode,
      origin: args.origin,
      waypoints: args.waypoints,
    });
  } finally {
    abort.clear();
  }

  if (!response.ok) {
    return unavailableGoogleRoutePlan({
      origin: args.origin,
      travelMode: args.travelMode,
      waypoints: args.waypoints,
      note: `google_routes_http_${response.status}`,
    });
  }

  const payload = await readJsonResponseBody(response);
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
  /**
   * 確定済み訪問の scheduleId 群。指定された訪問は「移動なし」で入力順のまま先頭に固定し、
   * 残り(緊急割込など)だけを貪欲法で並べ替える。p0_20 の「案1: 確定患者の移動なし」を実現する。
   * 既定 [] のときは従来どおり全件を最適化する(後方互換)。
   */
  lockedScheduleIds?: string[];
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
  const nodes: NodePoint[] = [
    { lat: args.origin.lat, lng: args.origin.lng },
    ...args.waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
  ];
  const matrix = await buildRouteMatrix({
    nodes,
    travelMode: args.travelMode,
    estimateRoadTravel,
  });

  // waypoint node index in `nodes` array = waypointIndex + 1 (0 is origin)
  const remaining = args.waypoints.map((_, idx) => idx); // indices into args.waypoints
  const ordered: number[] = [];
  const stopSummaries: VisitRoutePlan['stopSummaries'] = [];
  let currentNodeIndex = 0; // origin
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  const usesPriorityConstraint = hasPriorityRouteConstraint(args.waypoints);

  // 確定済み(ロック)訪問を入力順のまま先頭に固定する。残りは貪欲法で最適化する。
  const lockedScheduleIdSet = new Set(args.lockedScheduleIds ?? []);
  const hasLockedConstraint = lockedScheduleIdSet.size > 0;
  // 入力順に残っている最初のロック訪問の waypointIndex(未消化のロックがあるうちはこれを優先する)
  function nextLockedWaypointIndex(): number | null {
    if (!hasLockedConstraint) return null;
    for (let idx = 0; idx < args.waypoints.length; idx++) {
      if (lockedScheduleIdSet.has(args.waypoints[idx].scheduleId) && remaining.includes(idx)) {
        return idx;
      }
    }
    return null;
  }

  while (remaining.length > 0) {
    const forcedWaypointIdx = nextLockedWaypointIndex();
    if (forcedWaypointIdx !== null) {
      // ロック訪問は移動なし: 入力順のまま先頭側へ確定し、最適化対象から除外する
      const forcedRemIdx = remaining.indexOf(forcedWaypointIdx);
      remaining.splice(forcedRemIdx, 1);
      ordered.push(forcedWaypointIdx);
      const targetNodeIndex = forcedWaypointIdx + 1;
      const cell = matrix[currentNodeIndex][targetNodeIndex];
      const distanceMeters = cell ? cell.meters : null;
      const durationSeconds = cell ? cell.seconds : null;
      totalDistanceMeters += distanceMeters != null ? Math.round(distanceMeters) : 0;
      totalDurationSeconds += durationSeconds != null ? durationSeconds : 0;
      stopSummaries.push({
        scheduleId: args.waypoints[forcedWaypointIdx].scheduleId,
        optimizedOrder: ordered.length,
        arrivalOffsetSeconds: totalDurationSeconds,
        distanceFromPreviousMeters: distanceMeters != null ? Math.round(distanceMeters) : null,
        durationFromPreviousSeconds: durationSeconds,
      });
      currentNodeIndex = targetNodeIndex;
      continue;
    }

    let bestRemIdx = 0;
    const bestRank = Math.min(
      ...remaining.map((waypointIdx) => routePriorityRank(args.waypoints[waypointIdx].priority)),
    );
    let bestDistanceMeters = Number.POSITIVE_INFINITY;
    let bestDurationSeconds = Number.POSITIVE_INFINITY;

    for (let remIdx = 0; remIdx < remaining.length; remIdx++) {
      const waypointIdx = remaining[remIdx];
      if (routePriorityRank(args.waypoints[waypointIdx].priority) !== bestRank) {
        continue;
      }
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

  const returnToOrigin = matrix[currentNodeIndex]?.[0] ?? null;
  if (returnToOrigin) {
    totalDistanceMeters += Math.round(returnToOrigin.meters);
    totalDurationSeconds += returnToOrigin.seconds;
  }

  const baseNote = usesPriorityConstraint
    ? '優先度を優先したヒューリスティック順序を表示しています'
    : 'ヒューリスティック順序を表示しています';

  return {
    status: 'ok',
    note: hasLockedConstraint
      ? `確定済み訪問を固定したヒューリスティック順序を表示しています(${lockedScheduleIdSet.size}件固定)`
      : baseNote,
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
  /**
   * 緊急割込時に「移動させない」確定済み訪問の scheduleId 群(任意 / 既定 []).
   * 指定すると入力順のまま先頭に固定され、残りだけがヒューリスティックで並べ替えられる。
   * 1件以上指定された場合は Google 最適化を使わずヒューリスティック経路にフォールバックする
   *(Google Routes は中間地点の固定に非対応のため)。
   */
  lockedScheduleIds?: string[];
}): Promise<VisitRoutePlan> {
  const orderedScheduleIds = args.waypoints.map((waypoint) => waypoint.scheduleId);
  const hasLockedConstraint = (args.lockedScheduleIds?.length ?? 0) > 0;

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
  if (
    providerName === 'google' &&
    googleApiKey &&
    !hasPriorityRouteConstraint(args.waypoints) &&
    !hasLockedConstraint
  ) {
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
    ...(hasLockedConstraint ? { lockedScheduleIds: args.lockedScheduleIds } : {}),
  });
}
