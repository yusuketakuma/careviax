type RoutePoint = {
  lat: number | null;
  lng: number | null;
};

export type RouteTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

type TravelEstimate = {
  durationMinutes: number;
  distanceKm: number;
};

export interface RoutingProvider {
  estimate(
    from: RoutePoint,
    to: RoutePoint,
    travelMode: RouteTravelMode
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
    travelMode: RouteTravelMode
  ): Promise<TravelEstimate | null> {
    if (from.lat == null || from.lng == null || to.lat == null || to.lng == null) {
      return null;
    }

    const profile =
      travelMode === 'BICYCLE'
        ? 'cycling'
        : travelMode === 'WALK'
          ? 'foot'
          : this.profile;
    const url = new URL(
      `/table/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}`,
      this.baseUrl
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

      const payload = (await response.json()) as {
        durations?: number[][];
        distances?: number[][];
      };
      const durationSeconds = payload.durations?.[0]?.[0];
      const distanceMeters = payload.distances?.[0]?.[0];
      if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds)) {
        return null;
      }

      return {
        durationMinutes: durationSeconds / 60,
        distanceKm:
          typeof distanceMeters === 'number' && Number.isFinite(distanceMeters)
            ? distanceMeters / 1000
            : Number.NaN,
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
    travelMode: RouteTravelMode
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

      const payload = (await response.json()) as {
        routes?: Array<{ duration?: string; distanceMeters?: number }>;
      };
      const route = payload.routes?.[0];
      if (!route) return null;

      // duration is in the format "Xs" (e.g. "300s")
      const durationSeconds = route.duration
        ? parseInt(route.duration.replace('s', ''), 10)
        : null;
      if (durationSeconds == null || !Number.isFinite(durationSeconds)) return null;

      return {
        durationMinutes: durationSeconds / 60,
        distanceKm:
          typeof route.distanceMeters === 'number' && Number.isFinite(route.distanceMeters)
            ? route.distanceMeters / 1000
            : Number.NaN,
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
      Number(process.env.ROUTING_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
    );
  }

  // Default: OSRM
  const baseUrl = process.env.ROUTING_API_BASE_URL;
  if (!baseUrl) return null;
  return new OsrmProvider(
    baseUrl,
    process.env.ROUTING_API_PROFILE ?? 'driving',
    Number(process.env.ROUTING_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
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
