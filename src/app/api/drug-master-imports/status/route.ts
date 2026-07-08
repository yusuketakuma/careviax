import { NextRequest, NextResponse } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { internalError, success } from '@/lib/api/response';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import type { ImportSource, ImportStatus } from '@prisma/client';
import type {
  DrugMasterImportFreshnessLevel,
  DrugMasterImportStatusResponse,
} from '@/types/drug-master-import-status';

/**
 * GET /api/drug-master-imports/status
 *
 * Returns per-source freshness status for the drug master update dashboard.
 * Each source includes: last success date, record count, staleness assessment,
 * and the total DrugMaster record count.
 */

const ROUTE = '/api/drug-master-imports/status';

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

function assessFreshness(
  daysSinceImport: number | null,
  threshold: number,
): DrugMasterImportFreshnessLevel {
  if (daysSinceImport === null) return 'never';
  if (daysSinceImport <= threshold * 0.5) return 'fresh';
  if (daysSinceImport <= threshold) return 'aging';
  return 'stale';
}

function countFailureStreak(statuses: ImportStatus[]) {
  let streak = 0;
  for (const status of statuses) {
    if (status !== 'failed') break;
    streak += 1;
  }
  return streak;
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '医薬品マスター取込状態の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response as NextResponse;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const sources: ImportSource[] = [
      'ssk',
      'mhlw_price',
      'mhlw_generic',
      'hot',
      'pmda',
      'manual_clinical',
    ];
    const now = new Date();
    const recentSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Fetch latest successful import per source + latest failed.
    const [
      latestSuccessful,
      latestFailed,
      recentRuns,
      totalDrugCount,
      drugPackageCount,
      packageLinkedDrugCount,
      hotCodeCount,
      packageInsertCount,
      interactionCount,
      alertRuleCount,
      genericMappingCount,
    ] = await Promise.all([
      prisma.drugMasterImportLog.findMany({
        where: { status: 'completed' },
        orderBy: { imported_at: 'desc' },
        distinct: ['source'],
        select: {
          source: true,
          imported_at: true,
          record_count: true,
          source_file_hash: true,
          source_published_at: true,
          import_mode: true,
          change_summary: true,
        },
      }),
      prisma.drugMasterImportLog.findMany({
        where: { status: 'failed' },
        orderBy: { imported_at: 'desc' },
        distinct: ['source'],
        select: { source: true, imported_at: true, error_log: true },
      }),
      prisma.drugMasterImportLog.findMany({
        where: { imported_at: { gte: recentSince } },
        orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
        take: 300,
        select: { source: true, imported_at: true, status: true },
      }),
      prisma.drugMaster.count(),
      prisma.drugPackage.count(),
      prisma.drugMaster.count({ where: { drug_packages: { some: { is_active: true } } } }),
      prisma.drugMaster.count({ where: { hot_code: { not: null } } }),
      prisma.drugPackageInsert.count(),
      prisma.drugInteraction.count(),
      prisma.drugAlertRule.count({ where: { is_active: true, org_id: null } }),
      prisma.genericDrugMapping.count(),
    ]);

    const successBySource = new Map(latestSuccessful.map((r) => [r.source, r]));
    const failedBySource = new Map(latestFailed.map((r) => [r.source, r]));
    const recentRunsBySource = new Map<ImportSource, typeof recentRuns>();
    for (const run of recentRuns) {
      const runs = recentRunsBySource.get(run.source) ?? [];
      runs.push(run);
      recentRunsBySource.set(run.source, runs);
    }

    const sourceStatuses = sources.map((source) => {
      const lastSuccess = successBySource.get(source);
      const lastFailure = failedBySource.get(source);
      const sourceRecentRuns = recentRunsBySource.get(source) ?? [];
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
              source_file_hash: lastSuccess.source_file_hash,
              source_published_at: lastSuccess.source_published_at?.toISOString() ?? null,
              import_mode: lastSuccess.import_mode,
              change_summary: lastSuccess.change_summary,
            }
          : null,
        last_failure: lastFailure
          ? {
              imported_at: lastFailure.imported_at.toISOString(),
              error: lastFailure.error_log?.slice(0, 200) ?? null,
            }
          : null,
        recent_runs_30d: {
          total: sourceRecentRuns.length,
          failed: sourceRecentRuns.filter((run) => run.status === 'failed').length,
          failure_streak: countFailureStreak(sourceRecentRuns.map((run) => run.status)),
          latest_status: sourceRecentRuns[0]?.status ?? null,
          latest_imported_at: sourceRecentRuns[0]?.imported_at.toISOString() ?? null,
        },
        freshness: assessFreshness(daysSinceImport, threshold),
      };
    });

    const statusPayload = {
      sources: sourceStatuses,
      totals: {
        drug_master_count: totalDrugCount,
        drug_package_count: drugPackageCount,
        drug_package_coverage:
          totalDrugCount > 0 ? Math.round((packageLinkedDrugCount / totalDrugCount) * 100) : 0,
        hot_code_coverage:
          totalDrugCount > 0 ? Math.round((hotCodeCount / totalDrugCount) * 100) : 0,
        package_insert_count: packageInsertCount,
        interaction_count: interactionCount,
        active_alert_rule_count: alertRuleCount,
        generic_mapping_count: genericMappingCount,
      },
      checked_at: now.toISOString(),
    } satisfies DrugMasterImportStatusResponse;

    return success({ data: statusPayload }) as NextResponse;
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'drug_master_imports_status_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
