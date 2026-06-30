import { describe, expect, it } from 'vitest';

import {
  buildDrugMasterApiPath,
  buildDrugMasterGenericRecommendationsApiPath,
  buildDrugMasterIngredientGroupApiPath,
  buildDrugMastersApiPath,
} from './api-paths';

describe('drug master API path helpers', () => {
  it('builds collection paths while preserving the existing empty-query shape', () => {
    expect(buildDrugMastersApiPath()).toBe('/api/drug-masters');
    expect(buildDrugMastersApiPath(new URLSearchParams())).toBe('/api/drug-masters?');

    const params = new URLSearchParams({ q: 'ロキソ', limit: '8' });
    expect(buildDrugMastersApiPath(params)).toBe(
      `/api/drug-masters?q=${encodeURIComponent('ロキソ')}&limit=8`,
    );
  });

  it('encodes hostile drug master ids for nested paths', () => {
    const drugMasterId = 'drug/a b?x=y#z';

    expect(buildDrugMasterApiPath(drugMasterId)).toBe(
      `/api/drug-masters/${encodeURIComponent(drugMasterId)}`,
    );
    expect(buildDrugMasterGenericRecommendationsApiPath(drugMasterId, 'limit=8')).toBe(
      `/api/drug-masters/${encodeURIComponent(drugMasterId)}/generic-recommendations?limit=8`,
    );
    expect(buildDrugMasterIngredientGroupApiPath(drugMasterId, 'limit=50')).toBe(
      `/api/drug-masters/${encodeURIComponent(drugMasterId)}/ingredient-group?limit=50`,
    );
  });

  it('rejects dot segments before fetch can rewrite the route', () => {
    expect(() => buildDrugMasterApiPath('.')).toThrow(RangeError);
    expect(() => buildDrugMasterGenericRecommendationsApiPath('..')).toThrow(RangeError);
    expect(() => buildDrugMasterIngredientGroupApiPath('.')).toThrow(RangeError);
  });
});
