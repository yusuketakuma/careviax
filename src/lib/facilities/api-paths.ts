import { encodePathSegment } from '@/lib/http/path-segment';

export const ADMIN_FACILITIES_API_PATH = '/api/admin/facilities';

export function buildAdminFacilitiesApiPath(params: URLSearchParams) {
  return `${ADMIN_FACILITIES_API_PATH}?${params.toString()}`;
}

export function buildAdminFacilityApiPath(facilityId: string) {
  return `${ADMIN_FACILITIES_API_PATH}/${encodePathSegment(facilityId)}`;
}

export function buildAdminFacilityContactsApiPath(facilityId: string) {
  return `${buildAdminFacilityApiPath(facilityId)}/contacts`;
}

export function buildAdminFacilityUnitsApiPath(facilityId: string) {
  return `${buildAdminFacilityApiPath(facilityId)}/units`;
}

export function buildAdminFacilityUnitApiPath(facilityId: string, unitId: string) {
  return `${buildAdminFacilityUnitsApiPath(facilityId)}/${encodePathSegment(unitId)}`;
}
