import { describe, expect, it } from 'vitest';
import { SERVICE_AREAS_API_PATH, buildServiceAreaApiPath } from './api-paths';

describe('service area API path helpers', () => {
  it('builds the collection API path', () => {
    expect(SERVICE_AREAS_API_PATH).toBe('/api/service-areas');
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildServiceAreaApiPath('area_1')).toBe('/api/service-areas/area_1');
  });

  it('encodes only the area id path segment', () => {
    const areaId = 'area/1?mode=x#frag';

    expect(buildServiceAreaApiPath(areaId)).toBe(
      `/api/service-areas/${encodeURIComponent(areaId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment area id %s', (areaId) => {
    expect(() => buildServiceAreaApiPath(areaId)).toThrow(RangeError);
  });
});
