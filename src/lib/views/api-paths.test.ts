import { describe, expect, it } from 'vitest';
import {
  ME_PREFERENCES_API_PATH,
  SAVED_VIEWS_API_PATH,
  buildSavedViewApiPath,
  buildSavedViewsApiPath,
} from './api-paths';

describe('view API path constants', () => {
  it('exposes client-safe collection and preference paths', () => {
    expect(ME_PREFERENCES_API_PATH).toBe('/api/me/preferences');
    expect(SAVED_VIEWS_API_PATH).toBe('/api/saved-views');
  });
});

describe('buildSavedViewsApiPath', () => {
  it('builds saved view collection paths with scope query', () => {
    expect(buildSavedViewsApiPath('schedules')).toBe('/api/saved-views?scope=schedules');
  });

  it('encodes scope values as query parameters', () => {
    expect(buildSavedViewsApiPath('schedule/shared')).toBe(
      '/api/saved-views?scope=schedule%2Fshared',
    );
  });
});

describe('buildSavedViewApiPath', () => {
  it('builds saved view detail API paths for normal ids', () => {
    expect(buildSavedViewApiPath('view_1')).toBe('/api/saved-views/view_1');
  });

  it('encodes only the saved view id path segment', () => {
    const viewId = 'view/1?tab=x#frag';

    expect(buildSavedViewApiPath(viewId)).toBe(`/api/saved-views/${encodeURIComponent(viewId)}`);
  });

  it.each(['.', '..'])('rejects exact dot-segment saved view id %s', (viewId) => {
    expect(() => buildSavedViewApiPath(viewId)).toThrow(RangeError);
  });
});
