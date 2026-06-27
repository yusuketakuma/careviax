import { describe, expect, it } from 'vitest';
import { buildSavedViewApiPath } from './api-paths';

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
