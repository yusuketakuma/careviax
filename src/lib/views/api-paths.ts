import { encodePathSegment } from '@/lib/http/path-segment';

export const ME_PREFERENCES_API_PATH = '/api/me/preferences';
export const SAVED_VIEWS_API_PATH = '/api/saved-views';

export function buildSavedViewsApiPath(scope: string) {
  const params = new URLSearchParams({ scope });
  return `${SAVED_VIEWS_API_PATH}?${params.toString()}`;
}

export function buildSavedViewApiPath(viewId: string) {
  return `${SAVED_VIEWS_API_PATH}/${encodePathSegment(viewId)}`;
}
