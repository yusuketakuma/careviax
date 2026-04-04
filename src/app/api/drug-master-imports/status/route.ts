import { NextRequest, NextResponse } from 'next/server';
import { success } from '@/lib/api/response';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import type { ImportSource } from '@prisma/client';

/**
 * GET /api/drug-master-imports/status
 *
 * Returns per-source freshness status for the drug master update dashboard.
 * Each source includes: last success date, record count, staleness assessment,
 * and the total DrugMaster record count.
 */

const FRESHNESS_THRESHOLDS: Record<ImportSource, number> = {
  ssk: 45,
  mhlw_price: 120,
  mhlw_generic: 120,
  hot: 60,
  pmda: 14,
  manual_clinical: 365,
};

const SOURCE_LABELS: Record<ImportSource, string> = {
  ssk: 'SSK基本マスター',
  mhlw_price: '厚労省 薬価基準収載品目リスト',
  mhlw_generic: '厚労省 一般名処方マスタ',
  hot: 'MEDIS HOTコードマスター',
  pmda: 'PMDA 添付文書',
  manual_clinical: '手動臨床ルール',
};

const FREE_SOURCES: ImportSource[] = ['ssk', 'mhlw_price', 'mhlw_generic'];

type FreshnessLevel = 'fresh' | 'aging' | 'stale' | 'never';

function assessFreshness(daysSinceImport: number | null, threshold: number): FreshnessLevel {
  if (daysSinceImport === null) return 'never';
  if (daysSinceImport <= threshold * 0.5) return 'fresh';
  if (daysSinceImport <= threshold) return 'aging';
  return 'stale';
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response as NextResponse;

  const sources: ImportSource[] = ['ssk', 'mhlw_price', 'mhlw_generic', 'hot', 'pmda', 'manual_clinical'];
  const now = new Date();

  // Fetch latest successful import per source + latest failed
  const [latestSuccessful, latestFailed, totalDrugCount, hotCodeCount, packageInsertCount, interactionCount, alertRuleCount, genericMappingCount] = await Promise.all([
    prisma.drugMasterImportLog.findMany({
      where: { status: 'completed' },
      orderBy: { imported_at: 'desc' },
      distinct: ['source'],
      select: { source: true, imported_at: true, record_count: true },
    }),
    prisma.drugMasterImportLog.findMany({
      where: { status: 'failed' },
      orderBy: { imported_at: 'desc' },
      distinct: ['source'],
      select: { source: true, imported_at: true, error_log: true },
    }),
    prisma.drugMaster.count(),
    prisma.drugMaster.count({ where: { hot_code: { not: null } } }),
    prisma.drugPackageInsert.count(),
    prisma.drugInteraction.count(),
    prisma.drugAlertRule.count({ where: { is_active: true } }),
    prisma.genericDrugMapping.count(),
  ]);

  const successBySource = new Map(latestSuccessful.map((r) => [r.source, r]));
  const failedBySource = new Map(latestFailed.map((r) => [r.source, r]));

  const sourceStatuses = sources.map((source) => {
    const lastSuccess = successBySource.get(source);
    const lastFailure = failedBySource.get(source);
    const threshold = FRESHNESS_THRESHOLDS[source];

    const daysSinceImport = lastSuccess
      ? Math.floor((now.getTime() - lastSuccess.imported_at.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return {
      source,
      label: SOURCE_LABELS[source],
      is_free: FREE_SOURCES.includes(source),
      threshold_days: threshold,
      last_success: lastSuccess
        ? {
            imported_at: lastSuccess.imported_at.toISOString(),
            record_count: lastSuccess.record_count,
            days_ago: daysSinceImport,
          }
        : null,
      last_failure: lastFailure
        ? {
            imported_at: lastFailure.imported_at.toISOString(),
            error: lastFailure.error_log?.slice(0, 200) ?? null,
          }
        : null,
      freshness: assessFreshness(daysSinceImport, threshold),
    };
  });

  return success({
    sources: sourceStatuses,
    totals: {
      drug_master_count: totalDrugCount,
      hot_code_coverage: totalDrugCount > 0 ? Math.round((hotCodeCount / totalDrugCount) * 100) : 0,
      package_insert_count: packageInsertCount,
      interaction_count: interactionCount,
      active_alert_rule_count: alertRuleCount,
      generic_mapping_count: genericMappingCount,
    },
    checked_at: now.toISOString(),
  }) as NextResponse;
}
