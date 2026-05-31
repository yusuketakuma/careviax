import { readJsonObject } from '@/lib/db/json';

type RoutePoint = {
  lat: number | null;
  lng: number | null;
};

export type RouteTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

type TravelEstimate = {
  durationMinutes: number;
  distanceKm: number;
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
}

// ─── OSRM Provider ────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 1500;

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;

      const payload = (await response.json()) as unknown;
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
      clearTimeout(timeout);
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        signal: controller.signal,
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

      const route = readGoogleRouteEstimate((await response.json()) as unknown);
      if (!route) return null;

      return {
        durationMinutes: route.durationSeconds / 60,
        distanceKm: route.distanceMeters === null ? Number.NaN : route.distanceMeters / 1000,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ─── Provider factory ─────────────────────────────────────────────────────────

function createProvider(): RoutingProvider | null {
  const providerName = process.env.ROUTING_API_PROVIDER ?? 'osrm';

  if (providerName === 'google') {
    const apiKey = process.env.GOOGLE_ROUTES_API_KEY;
    if (!apiKey) return null;
    return new GoogleRoutesProvider(
      apiKey,
      Number(process.env.ROUTING_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    );
  }

  // Default: OSRM
  const baseUrl = process.env.ROUTING_API_BASE_URL;
  if (!baseUrl) return null;
  return new OsrmProvider(
    baseUrl,
    process.env.ROUTING_API_PROFILE ?? 'driving',
    Number(process.env.ROUTING_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createRoadTravelEstimator(travelMode: RouteTravelMode = 'DRIVE') {
  const cache = new Map<string, Promise<TravelEstimate | null>>();
  const provider = createProvider();

  return async (from: RoutePoint, to: RoutePoint): Promise<TravelEstimate | null> => {
    if (!provider) return null;

    const key = `${travelMode}:${from.lat ?? 'na'}:${from.lng ?? 'na'}=>${to.lat ?? 'na'}:${to.lng ?? 'na'}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const estimatePromise = provider.estimate(from, to, travelMode);
    cache.set(key, estimatePromise);
    return estimatePromise;
  };
}
