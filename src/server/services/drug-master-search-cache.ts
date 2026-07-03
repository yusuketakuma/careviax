/**
 * In-memory TTL cache for the org-independent portion of the drug master
 * search (GET /api/drug-masters). DrugMaster / GenericDrugMapping are global
 * masters (org_id なし) that only change via the admin drug-master import
 * jobs, so the search result for a given query is safe to share across all
 * orgs for a short TTL.
 *
 * Org/site-specific enrichment (formulary stock_config) must never be cached
 * here — callers attach it after reading from this cache.
 */
import { serverCache } from '@/lib/utils/server-cache';

const DRUG_MASTER_SEARCH_CACHE_PREFIX = 'drug-masters:search:';

// マスタは import ジョブ経由でしか変わらない準静的データのため、短い TTL で許容する。
export const DRUG_MASTER_SEARCH_CACHE_TTL_MS = 120_000;

export type DrugMasterSearchCacheKeyParams = {
  q: string;
  category: string | undefined;
  generic: boolean;
  narcotic: boolean;
  highRisk: boolean;
  lasa: boolean;
  sort: string | undefined;
  order: string | undefined;
  offset: number;
  limit: number;
  includeTotal: boolean;
};

export function buildDrugMasterSearchCacheKey(params: DrugMasterSearchCacheKeyParams) {
  return `${DRUG_MASTER_SEARCH_CACHE_PREFIX}${JSON.stringify([
    params.q,
    params.category ?? '',
    params.generic,
    params.narcotic,
    params.highRisk,
    params.lasa,
    params.sort ?? '',
    params.order ?? '',
    params.offset,
    params.limit,
    params.includeTotal,
  ])}`;
}

export function invalidateDrugMasterSearchCache() {
  serverCache.invalidate(DRUG_MASTER_SEARCH_CACHE_PREFIX);
}
