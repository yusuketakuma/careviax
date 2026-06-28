import { encodePathSegment } from '@/lib/http/path-segment';

export const PHARMACY_SITES_API_PATH = '/api/pharmacy-sites';

export function buildPharmacySiteApiPath(siteId: string) {
  return `${PHARMACY_SITES_API_PATH}/${encodePathSegment(siteId)}`;
}

export function buildPharmacySiteInsuranceConfigsApiPath(siteId: string) {
  return `${buildPharmacySiteApiPath(siteId)}/insurance-configs`;
}

export function buildPharmacySiteInsuranceConfigApiPath(siteId: string, configId: string) {
  return `${buildPharmacySiteInsuranceConfigsApiPath(siteId)}/${encodePathSegment(configId)}`;
}
