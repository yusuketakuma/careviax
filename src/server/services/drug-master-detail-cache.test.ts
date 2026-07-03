import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerCacheMock, invalidateMock, getMock, setMock } = vi.hoisted(() => ({
  createServerCacheMock: vi.fn(),
  invalidateMock: vi.fn(),
  getMock: vi.fn(),
  setMock: vi.fn(),
}));

vi.mock('@/lib/utils/server-cache', () => ({
  createServerCache: createServerCacheMock,
}));

describe('drug-master-detail-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServerCacheMock.mockReturnValue({
      get: getMock,
      set: setMock,
      invalidate: invalidateMock,
    });
    vi.resetModules();
  });

  it('creates its own named ServerCache instance with a dedicated capacity (not the shared singleton)', async () => {
    await import('./drug-master-detail-cache');
    expect(createServerCacheMock).toHaveBeenCalledWith('drug-master-detail', 200);
  });

  describe('buildDrugMasterDetailCacheKey', () => {
    it('builds a deterministic key namespaced by id', async () => {
      const { buildDrugMasterDetailCacheKey } = await import('./drug-master-detail-cache');
      expect(buildDrugMasterDetailCacheKey('drug_1')).toBe(
        'drug-masters:detail-cache:id:drug_1',
      );
      expect(buildDrugMasterDetailCacheKey('drug_1')).toBe(
        buildDrugMasterDetailCacheKey('drug_1'),
      );
      expect(buildDrugMasterDetailCacheKey('drug_1')).not.toBe(
        buildDrugMasterDetailCacheKey('drug_2'),
      );
    });
  });

  describe('buildDrugMasterBatchCacheKey', () => {
    it('is order-independent (normalizes/sorts inputs) so equivalent requests share a cache entry', async () => {
      const { buildDrugMasterBatchCacheKey } = await import('./drug-master-detail-cache');
      const keyA = buildDrugMasterBatchCacheKey(['yj2', 'yj1'], ['id2', 'id1']);
      const keyB = buildDrugMasterBatchCacheKey(['yj1', 'yj2'], ['id1', 'id2']);
      expect(keyA).toBe(keyB);
    });

    it('differs when the set of ids/yj_codes differs', async () => {
      const { buildDrugMasterBatchCacheKey } = await import('./drug-master-detail-cache');
      const base = buildDrugMasterBatchCacheKey(['yj1'], ['id1']);
      expect(buildDrugMasterBatchCacheKey(['yj1', 'yj2'], ['id1'])).not.toBe(base);
      expect(buildDrugMasterBatchCacheKey(['yj1'], ['id1', 'id2'])).not.toBe(base);
      expect(buildDrugMasterBatchCacheKey([], ['id1'])).not.toBe(base);
    });

    it('does not collide with a detail-cache key for the same raw string', async () => {
      const { buildDrugMasterDetailCacheKey, buildDrugMasterBatchCacheKey } = await import(
        './drug-master-detail-cache'
      );
      expect(buildDrugMasterBatchCacheKey(['id_1'], [])).not.toBe(
        buildDrugMasterDetailCacheKey('id_1'),
      );
    });
  });

  describe('invalidateDrugMasterDetailCache', () => {
    it('invalidates only the drug-master detail-cache namespace (covers both detail and batch keys)', async () => {
      const { invalidateDrugMasterDetailCache } = await import('./drug-master-detail-cache');
      invalidateDrugMasterDetailCache();
      expect(invalidateMock).toHaveBeenCalledWith('drug-masters:detail-cache:');
    });
  });

  describe('get/set hit, miss, and TTL wiring', () => {
    it('returns undefined on a cache miss', async () => {
      getMock.mockReturnValue(undefined);
      const { drugMasterDetailCache, buildDrugMasterDetailCacheKey } = await import(
        './drug-master-detail-cache'
      );
      const key = buildDrugMasterDetailCacheKey('drug_1');
      expect(drugMasterDetailCache.get(key)).toBeUndefined();
      expect(getMock).toHaveBeenCalledWith(key);
    });

    it('returns the cached value on a cache hit', async () => {
      const cachedValue = { id: 'drug_1', drug_name: 'テスト薬' };
      getMock.mockReturnValue(cachedValue);
      const { drugMasterDetailCache, buildDrugMasterDetailCacheKey } = await import(
        './drug-master-detail-cache'
      );
      const key = buildDrugMasterDetailCacheKey('drug_1');
      expect(drugMasterDetailCache.get(key)).toBe(cachedValue);
    });

    it('sets entries with the exported 120s TTL', async () => {
      const {
        drugMasterDetailCache,
        buildDrugMasterDetailCacheKey,
        DRUG_MASTER_DETAIL_CACHE_TTL_MS,
      } = await import('./drug-master-detail-cache');
      expect(DRUG_MASTER_DETAIL_CACHE_TTL_MS).toBe(120_000);

      const key = buildDrugMasterDetailCacheKey('drug_1');
      const value = { id: 'drug_1' };
      drugMasterDetailCache.set(key, value, DRUG_MASTER_DETAIL_CACHE_TTL_MS);
      expect(setMock).toHaveBeenCalledWith(key, value, 120_000);
    });
  });
});
