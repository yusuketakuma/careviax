import { describe, expect, it } from 'vitest';
import { PHARMACISTS_API_PATH, buildPharmacistApiPath, buildPharmacistsApiPath } from './api-paths';

describe('pharmacist API path helpers', () => {
  it('builds the collection API path', () => {
    expect(PHARMACISTS_API_PATH).toBe('/api/pharmacists');
    expect(buildPharmacistsApiPath()).toBe('/api/pharmacists');
  });

  it('builds collection API paths with query params', () => {
    expect(buildPharmacistsApiPath(new URLSearchParams({ include_collaborators: 'true' }))).toBe(
      '/api/pharmacists?include_collaborators=true',
    );
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildPharmacistApiPath('user_1')).toBe('/api/pharmacists/user_1');
  });

  it('encodes dynamic path segments independently', () => {
    const pharmacistId = 'user/1?mode=x#frag';
    expect(buildPharmacistApiPath(pharmacistId)).toBe(
      `/api/pharmacists/${encodeURIComponent(pharmacistId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment pharmacist id %s', (pharmacistId) => {
    expect(() => buildPharmacistApiPath(pharmacistId)).toThrow(RangeError);
  });
});
