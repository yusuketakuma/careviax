import { readJsonResponseBody } from '@/lib/api/response-body';
import { readJsonObject } from '@/lib/db/json';
import { mapWithConcurrency, normalizeConcurrencyLimit } from '@/lib/utils/concurrency';
import { normalizePositiveTimeoutMs } from '@/lib/utils/timeout';
import { createFetchTimeout } from './fetch-timeout';

export type RoutePoint = {
  lat: number | null;
  lng: number | null;
};

export type RouteTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

export type TravelEstimate = {
  durationMinutes: number;
  distanceKm: number;
};

export type TravelEstimateMatrix = Array<Array<TravelEstimate | null>>;

export type RoadTravelEstimator = {
  (from: RoutePoint, to: RoutePoint): Promise<TravelEstimate | null>;
  estimateMatrix(points: RoutePoint[]): Promise<TravelEstimateMatrix | null>;
};

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readMatrixCell(payload: unknown, key: 'durations' | 'distances') {
  const object = readJsonObject(payload);
  if (!object || !Array.isArray(object[key])) return null;
  const row = object[key][0];
  if (!Array.isArray(row)) return null;
  return readFiniteNumber(row[0]);
}

function readNumericMatrix(payload: unknown, key: 'durations' | 'distances', size: number) {
  const object = readJsonObject(payload);
  if (!object || !Array.isArray(object[key]) || object[key].length !== size) return null;

  const matrix: Array<Array<number | null>> = [];
  for (const row of object[key]) {
    if (!Array.isArray(row) || row.length !== size) return null;
    const normalizedRow: Array<number | null> = [];
    for (const value of row) {
      if (value === null) {
        normalizedRow.push(null);
        continue;
      }
      const numericValue = readFiniteNumber(value);
      if (numericValue === null) return null;
      normalizedRow.push(numericValue);
    }
    matrix.push(normalizedRow);
  }

  return matrix;
}

function readOsrmTravelEstimateMatrix(payload: unknown, size: number): TravelEstimateMatrix | null {
  const durations = readNumericMatrix(payload, 'durations', size);
  if (!durations) return null;
  const distances = readNumericMatrix(payload, 'distances', size);
  if (!distances) return null;

  return durations.map((row, rowIndex) =>
    row.map((durationSeconds, columnIndex) => {
      if (durationSeconds === null) return null;
      const distanceMeters = distances[rowIndex]?.[columnIndex] ?? null;
      return {
        durationMinutes: durationSeconds / 60,
        distanceKm: distanceMeters === null ? Number.NaN : distanceMeters / 1000,
      };
    }),
  );
}

function parseGoogleDurationSeconds(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(value);
  if (!match) return null;
  return Math.round(Number.parseFloat(match[1]));
}

function readGoogleRouteEstimate(payload: unknown) {
  const object = readJsonObject(payload);
  if (!object || !Array.isArray(object.routes)) return null;

  const route = readJsonObject(object.routes[0]);
  if (!route) return null;

  const durationSeconds = parseGoogleDurationSeconds(route.duration);
  if (durationSeconds === null) return null;

  return {
    durationSeconds,
    distanceMeters: readFiniteNumber(route.distanceMeters),
  };
}

export interface RoutingProvider {
  estimate(
    from: RoutePoint,
    to: RoutePoint,
    travelMode: RouteTravelMode,
  ): Promise<TravelEstimate | null>;
  estimateMatrix?(
    points: RoutePoint[],
    travelMode: RouteTravelMode,
  ): Promise<TravelEstimateMatrix | null>;
}

// ─── OSRM Provider ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MATRIX_PAIR_CONCURRENCY = 8;
const MAX_MATRIX_PAIR_CONCURRENCY = 16;
const DEFAULT_MAX_MATRIX_PAIR_FALLBACKS = 64;
const MAX_MATRIX_PAIR_FALLBACKS = 256;

function normalizeMatrixPairConcurrency(value: unknown) {
  return normalizeConcurrencyLimit(value, {
    defaultValue: DEFAULT_MATRIX_PAIR_CONCURRENCY,
    max: MAX_MATRIX_PAIR_CONCURRENCY,
  });
}

function normalizeMaxMatrixPairFallbacks(value: unknown) {
  return normalizeConcurrencyLimit(value, {
    defaultValue: DEFAULT_MAX_MATRIX_PAIR_FALLBACKS,
    max: MAX_MATRIX_PAIR_FALLBACKS,
  });
}

function createEmptyTravelEstimateMatrix(size: number): TravelEstimateMatrix {
  return Array.from({ length: size }, () => new Array<TravelEstimate | null>(size).fill(null));
}

class OsrmProvider implements RoutingProvider {
  private readonly baseUrl: string;
  private readonly profile: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, profile: string, timeoutMs: number) {
    this.baseUrl = baseUrl;
    this.profile = profile;
    this.timeoutMs = timeoutMs;
  }

  async estimate(
    from: RoutePoint,
    to: RoutePoint,
    travelMode: RouteTravelMode,
  ): Promise<TravelEstimate | null> {
    if (from.lat == null || from.lng == null || to.lat == null || to.lng == null) {
      return null;
    }

    const profile =
      travelMode === 'BICYCLE' ? 'cycling' : travelMode === 'WALK' ? 'foot' : this.profile;
    const url = new URL(
      `/table/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}`,
      this.baseUrl,
    );
    url.searchParams.set('annotations', 'distance,duration');
    url.searchParams.set('sources', '0');
    url.searchParams.set('destinations', '1');

    const abort = createFetchTimeout(this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: abort.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;

      const payload = await readJsonResponseBody(response);
      const durationSeconds = readMatrixCell(payload, 'durations');
      if (durationSeconds === null) {
        return null;
      }
      const distanceMeters = readMatrixCell(payload, 'distances');

      return {
        durationMinutes: durationSeconds / 60,
        distanceKm: distanceMeters === null ? Number.NaN : distanceMeters / 1000,
      };
    } catch {
      return null;
    } finally {
      abort.clear();
    }
  }

  async estimateMatrix(
    points: RoutePoint[],
    travelMode: RouteTravelMode,
  ): Promise<TravelEstimateMatrix | null> {
    if (points.length === 0) return [];
    if (points.some((point) => point.lat == null || point.lng == null)) return null;

    const profile =
      travelMode === 'BICYCLE' ? 'cycling' : travelMode === 'WALK' ? 'foot' : this.profile;
    const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(';');
    const url = new URL(`/table/v1/${profile}/${coordinates}`, this.baseUrl);
    url.searchParams.set('annotations', 'distance,duration');

    const abort = createFetchTimeout(this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: abort.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;

      return readOsrmTravelEstimateMatrix(await readJsonResponseBody(response), points.length);
    } catch {
      return null;
    } finally {
      abort.clear();
    }
  }
}

// ─── Google Routes Provider ───────────────────────────────────────────────────

class GoogleRoutesProvider implements RoutingProvider {
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs: number) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async estimate(
    from: RoutePoint,
    to: RoutePoint,
    travelMode: RouteTravelMode,
  ): Promise<TravelEstimate | null> {
    if (from.lat == null || from.lng == null || to.lat == null || to.lng == null) {
      return null;
    }

    const abort = createFetchTimeout(this.timeoutMs);

    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
          destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
          travelMode,
          routingPreference: 'TRAFFIC_UNAWARE',
        }),
        cache: 'no-store',
      });
      if (!response.ok) return null;

      const route = readGoogleRouteEstimate(await readJsonResponseBody(response));
      if (!route) return null;

      return {
        durationMinutes: route.durationSeconds / 60,
        distanceKm: route.distanceMeters === null ? Number.NaN : route.distanceMeters / 1000,
      };
    } catch {
      return null;
    } finally {
      abort.clear();
    }
  }
}

// ─── Provider factory ─────────────────────────────────────────────────────────

function createProvider(): RoutingProvider | null {
  const providerName = process.env.ROUTING_API_PROVIDER ?? 'osrm';
  const timeoutMs = normalizePositiveTimeoutMs(process.env.ROUTING_API_TIMEOUT_MS, {
    fallbackMs: DEFAULT_TIMEOUT_MS,
  });

  if (providerName === 'google') {
    const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
    if (!apiKey) return null;
    return new GoogleRoutesProvider(apiKey, timeoutMs);
  }

  // Default: OSRM
  const baseUrl = process.env.ROUTING_API_BASE_URL;
  if (!baseUrl) return null;
  return new OsrmProvider(baseUrl, process.env.ROUTING_API_PROFILE ?? 'driving', timeoutMs);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createRoadTravelEstimator(
  travelMode: RouteTravelMode = 'DRIVE',
): RoadTravelEstimator {
  const cache = new Map<string, Promise<TravelEstimate | null>>();
  const provider = createProvider();

  const estimateTravel = (async (
    from: RoutePoint,
    to: RoutePoint,
  ): Promise<TravelEstimate | null> => {
    if (!provider) return null;

    const key = `${travelMode}:${from.lat ?? 'na'}:${from.lng ?? 'na'}=>${to.lat ?? 'na'}:${to.lng ?? 'na'}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const estimatePromise = provider.estimate(from, to, travelMode);
    cache.set(key, estimatePromise);
    return estimatePromise;
  }) as RoadTravelEstimator;

  estimateTravel.estimateMatrix = async (points: RoutePoint[]) => {
    if (!provider) return null;
    const providerMatrix = await provider.estimateMatrix?.(points, travelMode);
    if (providerMatrix) return providerMatrix;

    const pairCount = Math.max(0, points.length * (points.length - 1));
    if (
      pairCount > normalizeMaxMatrixPairFallbacks(process.env.ROUTING_API_MAX_MATRIX_PAIR_FALLBACKS)
    ) {
      return createEmptyTravelEstimateMatrix(points.length);
    }

    const matrix = createEmptyTravelEstimateMatrix(points.length);
    const pairs: Array<{ i: number; j: number }> = [];
    for (let i = 0; i < points.length; i += 1) {
      for (let j = 0; j < points.length; j += 1) {
        if (i !== j) pairs.push({ i, j });
      }
    }

    await mapWithConcurrency(
      pairs,
      normalizeMatrixPairConcurrency(process.env.ROUTING_API_CONCURRENCY),
      async ({ i, j }) => {
        matrix[i][j] = await estimateTravel(points[i]!, points[j]!);
      },
    );

    return matrix;
  };

  return estimateTravel;
}
