import { encodePathSegment } from '@/lib/http/path-segment';

export function buildSavedViewApiPath(viewId: string) {
  return `/api/saved-views/${encodePathSegment(viewId)}`;
}
