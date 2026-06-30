import { encodePathSegment } from '@/lib/http/path-segment';

export const PHARMACISTS_API_PATH = '/api/pharmacists';

export function buildPharmacistsApiPath(params?: URLSearchParams) {
  const query = params?.toString() ?? '';
  return query ? `${PHARMACISTS_API_PATH}?${query}` : PHARMACISTS_API_PATH;
}

export function buildPharmacistApiPath(pharmacistId: string) {
  return `${PHARMACISTS_API_PATH}/${encodePathSegment(pharmacistId)}`;
}
