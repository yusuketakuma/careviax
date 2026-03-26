type RoutePoint = {
  lat: number | null;
  lng: number | null;
};

type TravelEstimate = {
  durationMinutes: number;
  distanceKm: number;
};

const DEFAULT_TIMEOUT_MS = 1500;

function getRoutingConfig() {
  const baseUrl = process.env.ROUTING_API_BASE_URL;
  if (!baseUrl) return null;

  return {
    baseUrl,
    profile: process.env.ROUTING_API_PROFILE ?? 'driving',
    timeoutMs: Number(process.env.ROUTING_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

async function fetchRoadEstimate(
  from: RoutePoint,
  to: RoutePoint
): Promise<TravelEstimate | null> {
  if (
    from.lat == null ||
    from.lng == null ||
    to.lat == null ||
    to.lng == null
  ) {
    return null;
  }

  const config = getRoutingConfig();
  if (!config) return null;

  const url = new URL(
    `/table/v1/${config.profile}/${from.lng},${from.lat};${to.lng},${to.lat}`,
    config.baseUrl
  );
  url.searchParams.set('annotations', 'distance,duration');
  url.searchParams.set('sources', '0');
  url.searchParams.set('destinations', '1');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      durations?: number[][];
      distances?: number[][];
    };
    const durationSeconds = payload.durations?.[0]?.[0];
    const distanceMeters = payload.distances?.[0]?.[0];
    if (
      typeof durationSeconds !== 'number' ||
      !Number.isFinite(durationSeconds)
    ) {
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

export function createRoadTravelEstimator() {
  const cache = new Map<string, Promise<TravelEstimate | null>>();

  return async (from: RoutePoint, to: RoutePoint) => {
    const key = `${from.lat ?? 'na'}:${from.lng ?? 'na'}=>${to.lat ?? 'na'}:${to.lng ?? 'na'}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const estimatePromise = fetchRoadEstimate(from, to);
    cache.set(key, estimatePromise);
    return estimatePromise;
  };
}
