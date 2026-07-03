import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invalidateMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
}));

vi.mock('@/lib/utils/server-cache', () => ({
  serverCache: {
    invalidate: invalidateMock,
  },
}));

import {
  buildDrugMasterSearchCacheKey,
  invalidateDrugMasterSearchCache,
} from './drug-master-search-cache';

describe('buildDrugMasterSearchCacheKey', () => {
  const baseParams = {
    q: 'アムロ',
    category: undefined,
    generic: false,
    narcotic: false,
    highRisk: false,
    lasa: false,
    sort: undefined,
    order: undefined,
    offset: 0,
    limit: 50,
    includeTotal: true,
  };

  it('is deterministic for identical query parameters', () => {
    expect(buildDrugMasterSearchCacheKey(baseParams)).toBe(
      buildDrugMasterSearchCacheKey({ ...baseParams }),
    );
  });

  it('differs when any query parameter changes', () => {
    const base = buildDrugMasterSearchCacheKey(baseParams);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, q: 'ロキソ' })).not.toBe(base);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, generic: true })).not.toBe(base);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, highRisk: true })).not.toBe(base);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, offset: 50 })).not.toBe(base);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, limit: 10 })).not.toBe(base);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, includeTotal: false })).not.toBe(base);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, sort: 'drug_name' })).not.toBe(base);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, order: 'desc' })).not.toBe(base);
    expect(buildDrugMasterSearchCacheKey({ ...baseParams, category: '2171' })).not.toBe(base);
  });
});

describe('invalidateDrugMasterSearchCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates only the drug-master search cache namespace', () => {
    invalidateDrugMasterSearchCache();
    expect(invalidateMock).toHaveBeenCalledWith('drug-masters:search:');
  });
});
