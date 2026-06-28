import { encodePathSegment } from '@/lib/http/path-segment';

export const SERVICE_AREAS_API_PATH = '/api/service-areas';

export function buildServiceAreaApiPath(areaId: string) {
  return `${SERVICE_AREAS_API_PATH}/${encodePathSegment(areaId)}`;
}
