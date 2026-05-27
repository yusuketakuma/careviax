export const VISIT_LOCATION_TRACKING_STORAGE_KEY =
  'ph-os:user-visit-location-tracking-enabled';

export type VisitLocationPermissionState =
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unsupported'
  | 'unavailable';

export type VisitGeoPoint = {
  captured_at: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
};

export type VisitGeoLog = {
  enabled: boolean;
  permission: VisitLocationPermissionState;
  start: VisitGeoPoint | null;
  end: VisitGeoPoint | null;
};

export function getVisitLocationTrackingPreference() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(VISIT_LOCATION_TRACKING_STORAGE_KEY) === 'true';
}

export function setVisitLocationTrackingPreference(enabled: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    VISIT_LOCATION_TRACKING_STORAGE_KEY,
    enabled ? 'true' : 'false'
  );
}

export async function getVisitLocationPermissionState(): Promise<VisitLocationPermissionState> {
  if (typeof window === 'undefined' || !('navigator' in window)) {
    return 'unsupported';
  }

  if (!('geolocation' in navigator)) {
    return 'unsupported';
  }

  if (!('permissions' in navigator) || typeof navigator.permissions.query !== 'function') {
    return 'prompt';
  }

  try {
    const result = await navigator.permissions.query({
      name: 'geolocation',
    } as PermissionDescriptor);
    if (result.state === 'granted') return 'granted';
    if (result.state === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

export async function captureVisitGeoPoint(): Promise<VisitGeoPoint> {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    throw new Error('この端末では位置情報を利用できません');
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  });

  return {
    captured_at: new Date(position.timestamp).toISOString(),
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy_meters: Number.isFinite(position.coords.accuracy)
      ? Math.round(position.coords.accuracy)
      : null,
  };
}
