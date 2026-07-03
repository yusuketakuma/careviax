/**
 * In-memory TTL cache for global drug master detail reads:
 *  - GET  /api/drug-masters/[id]
 *  - POST /api/drug-masters/batch
 *
 * DrugMaster (and its package_inserts / interactions relations) is a global
 * master (org_id なし) that only changes via the admin drug-master import
 * jobs, so a detail/batch result is safe to share across all orgs for a
 * short TTL — same rationale as drug-master-search-cache.ts.
 *
 * このキャッシュは src/lib/utils/server-cache.ts の共有 singleton
 * (`serverCache` / DEFAULT_MAX_ENTRIES=50) を再利用しない。detail/batch は
 * 検索結果キャッシュより高頻度に異なる id/組み合わせでヒットするため、
 * 専用 Map・専用 cap（200 エントリ）を持つ独立インスタンスにする。
 *
 * 既知の許容範囲: プロセス単位の in-memory cache のため、複数インスタンス構成
 * では import 直後に他インスタンスが最大 TTL 分 stale になり得る。マスタは
 * import ジョブ経由でしか更新されず変更頻度が低いため許容する。
 *
 * 非ゴール: generic-recommendations / ingredient-group / package-insert など
 * org スコープのエンドポイントは絶対にここでキャッシュしない
 * （テナント漏洩リスクがあるため明示的に対象外）。
 */
import { createServerCache } from '@/lib/utils/server-cache';

const DRUG_MASTER_DETAIL_CACHE_MAX_ENTRIES = 200;
const DRUG_MASTER_DETAIL_CACHE_NAMESPACE = 'drug-masters:detail-cache:';

export const DRUG_MASTER_DETAIL_CACHE_TTL_MS = 120_000;

export const drugMasterDetailCache = createServerCache(
  'drug-master-detail',
  DRUG_MASTER_DETAIL_CACHE_MAX_ENTRIES,
);

export function buildDrugMasterDetailCacheKey(id: string) {
  return `${DRUG_MASTER_DETAIL_CACHE_NAMESPACE}id:${id}`;
}

export function buildDrugMasterBatchCacheKey(yjCodes: string[], drugMasterIds: string[]) {
  const normalizedYjCodes = [...yjCodes].sort();
  const normalizedDrugMasterIds = [...drugMasterIds].sort();
  return `${DRUG_MASTER_DETAIL_CACHE_NAMESPACE}batch:${JSON.stringify([
    normalizedYjCodes,
    normalizedDrugMasterIds,
  ])}`;
}

export function invalidateDrugMasterDetailCache() {
  drugMasterDetailCache.invalidate(DRUG_MASTER_DETAIL_CACHE_NAMESPACE);
}
