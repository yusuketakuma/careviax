import { encodePathSegment } from '@/lib/http/path-segment';

export const PACKAGING_METHODS_API_PATH = '/api/packaging-methods';

export function buildPackagingMethodApiPath(methodId: string) {
  return `${PACKAGING_METHODS_API_PATH}/${encodePathSegment(methodId)}`;
}
