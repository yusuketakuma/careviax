import { encodePathSegment } from '@/lib/http/path-segment';

export const VISIT_VEHICLE_RESOURCES_API_PATH = '/api/visit-vehicle-resources';

export function buildVisitVehicleResourcesApiPath(params: URLSearchParams) {
  return `${VISIT_VEHICLE_RESOURCES_API_PATH}?${params.toString()}`;
}

export function buildVisitVehicleResourceApiPath(vehicleResourceId: string) {
  return `${VISIT_VEHICLE_RESOURCES_API_PATH}/${encodePathSegment(vehicleResourceId)}`;
}
