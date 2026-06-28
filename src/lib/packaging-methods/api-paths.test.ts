import { describe, expect, it } from 'vitest';
import { PACKAGING_METHODS_API_PATH, buildPackagingMethodApiPath } from './api-paths';

describe('packaging method API path helpers', () => {
  it('builds the collection API path', () => {
    expect(PACKAGING_METHODS_API_PATH).toBe('/api/packaging-methods');
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildPackagingMethodApiPath('method_1')).toBe('/api/packaging-methods/method_1');
  });

  it('encodes only the method id path segment', () => {
    const methodId = 'method/1?mode=x#frag';

    expect(buildPackagingMethodApiPath(methodId)).toBe(
      `/api/packaging-methods/${encodeURIComponent(methodId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment method id %s', (methodId) => {
    expect(() => buildPackagingMethodApiPath(methodId)).toThrow(RangeError);
  });
});
