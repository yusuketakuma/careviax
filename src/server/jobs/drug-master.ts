import { prisma } from '@/lib/db/client';
import { formatUtcDateKey } from '@/lib/date-key';
import {
  importGenericNameMappings,
  importMhlwGenericFlags,
  importMhlwPriceList,
} from '@/server/services/drug-master-import/mhlw';
import { importPmdaPackageInserts } from '@/server/services/drug-master-import/pmda';
import {
  buildSskDrugMasterDedupeKey,
  fetchLatestSskDrugMasterZip,
  importSskDrugMaster,
} from '@/server/services/drug-master-import/ssk';
import type { ImportSource } from '@prisma/client';
import { runJob } from './runner';

// ── Freshness thresholds (days) ──

const FRESHNESS_THRESHOLDS: Record<ImportSource, number> = {
  ssk: 45, // SSK: monthly → alert after 45 days
  mhlw_price: 120, // MHLW price: annual + mid-year → alert after 120 days
  mhlw_generic: 120, // MHLW generic: same cycle as price
  hot: 60, // HOT: monthly → alert after 60 days (disabled until licensed)
  pmda: 14, // PMDA: daily delta → alert after 14 days
  manual_clinical: 365, // Manual: annual review
};

/** Sources that are free and require no registration */
const FREE_SOURCES: ImportSource[] = ['ssk', 'mhlw_price', 'mhlw_generic'];
const DEFAULT_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT = 1;
const MAX_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT = 100;

type AdminNotificationInput = {
  title: string;
  message: string;
  link: string;
  dedupeKey: string;
};

function resolvePackageCoverageAlertThresholdPercent(
  value: string | undefined = process.env.DRUG_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT,
) {
  const parsed = Number(value ?? DEFAULT_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT);
  if (!Number.isFinite(parsed)) return DEFAULT_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT;
  const normalized = Math.trunc(parsed);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    return DEFAULT_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT;
  }
  return Math.min(normalized, MAX_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT);
}

function formatCoveragePercent(numerator: number, denominator: number) {
  if (denominator <= 0) return 100;
  return Math.round((numerator / denominator) * 1000) / 10;
}

async function notifyAdmins(input: AdminNotificationInput) {
  const adminMemberships = await prisma.membership.findMany({
    where: { role: { in: ['admin', 'owner'] }, is_active: true },
    select: { user_id: true, org_id: true },
  });

  if (adminMemberships.length === 0) return;

  await prisma.notification.createMany({
    data: adminMemberships.map((admin) => ({
      org_id: admin.org_id,
      user_id: admin.user_id,
      type: 'system' as const,
      title: input.title,
      message: input.message,
      link: input.link,
      dedupe_key: input.dedupeKey,
    })),
    skipDuplicates: true,
  });
}

export async function refreshSskDrugMaster() {
  const latestZipPayload = await fetchLatestSskDrugMasterZip();
  const dedupeKey = buildSskDrugMasterDedupeKey(latestZipPayload.sourceFileHash);

  const latestCompletedJob = await prisma.integrationJob.findFirst({
    where: {
      job_type: 'drug_master_refresh',
      status: 'completed',
      dedupe_key: { not: null },
    },
    orderBy: { created_at: 'desc' },
    select: {
      dedupe_key: true,
    },
  });

  return runJob(
    'drug_master_refresh',
    async () => {
      if (latestCompletedJob?.dedupe_key === dedupeKey) {
        return {
          processedCount: 0,
          errors: [],
        };
      }

      const result = await importSskDrugMaster(prisma, { zipPayload: latestZipPayload });
      return {
        processedCount: result.importedCount,
      };
    },
    undefined,
    dedupeKey,
  );
}

export async function refreshMhlwDrugReferences() {
  return runJob('drug_reference_refresh', async () => {
    const [priceResult, genericFlagsResult, mappingResult] = await Promise.all([
      importMhlwPriceList(prisma),
      importMhlwGenericFlags(prisma),
      importGenericNameMappings(prisma),
    ]);

    return {
      processedCount:
        priceResult.importedCount + genericFlagsResult.importedCount + mappingResult.importedCount,
    };
  });
}

export async function refreshPmdaPackageInsertsDelta() {
  return runJob('pmda_package_insert_refresh', async () => {
    const result = await importPmdaPackageInserts(prisma, { mode: 'delta' });
    return {
      processedCount: result.importedCount,
    };
  });
}

/**
 * フリーマスター一括更新（SSK → MHLW の順序実行）
 *
 * SSK が DrugMaster の基盤テーブルを更新し、
 * MHLW はその上に薬価・一般名・後発品情報を載せるため、
 * SSK を先に完了させてから MHLW を実行する。
 */
export async function refreshAllFreeDrugMasters() {
  return runJob('drug_master_auto_refresh', async () => {
    // Phase 1: SSK — DrugMaster 全量更新
    const sskResult = await refreshSskDrugMaster();

    // Phase 2: MHLW — 薬価 + 一般名 + 後発品（SSK 完了後に並列実行）
    const mhlwResult = await refreshMhlwDrugReferences();

    return {
      processedCount: sskResult.processedCount + mhlwResult.processedCount,
      details: {
        ssk: sskResult.processedCount,
        mhlw: mhlwResult.processedCount,
      },
    };
  });
}

/**
 * 医薬品マスター鮮度監視
 *
 * 各フリーデータソースの最終成功取込日を確認し、
 * 閾値を超過している場合に管理者通知を生成する。
 * 日次ジョブから呼び出すことを想定。
 */
export async function checkDrugMasterFreshness() {
  return runJob('drug_master_freshness_check', async () => {
    // Only check free sources that don't require registration/licensing
    const sources = FREE_SOURCES;
    const now = new Date();
    const dedupeDate = formatUtcDateKey(now);
    let alertCount = 0;

    for (const source of sources) {
      const threshold = FRESHNESS_THRESHOLDS[source];
      const lastSuccess = await prisma.drugMasterImportLog.findFirst({
        where: { source, status: 'completed' },
        orderBy: { imported_at: 'desc' },
        select: { imported_at: true, record_count: true },
      });

      const daysSinceLastImport = lastSuccess
        ? Math.floor((now.getTime() - lastSuccess.imported_at.getTime()) / (1000 * 60 * 60 * 24))
        : Infinity;

      if (daysSinceLastImport > threshold) {
        const label = SOURCE_LABELS[source] ?? source;
        const message = lastSuccess
          ? `${label}の最終取込から${daysSinceLastImport}日が経過しています（閾値: ${threshold}日）。自動更新の実行状況を確認してください`
          : `${label}の取込実績がありません。初回取込を実行してください`;

        await notifyAdmins({
          title: '医薬品マスター更新遅延',
          message,
          link: '/admin/drug-masters',
          dedupeKey: `drug-master-stale:${source}:${dedupeDate}`,
        });
        alertCount++;
      }
    }

    const [drugMasterCount, packageLinkedDrugMasterCount] = await Promise.all([
      prisma.drugMaster.count(),
      prisma.drugMaster.count({
        where: { drug_packages: { some: { is_active: true } } },
      }),
    ]);
    const packageCoveragePercent = formatCoveragePercent(
      packageLinkedDrugMasterCount,
      drugMasterCount,
    );
    const packageCoverageThreshold = resolvePackageCoverageAlertThresholdPercent();

    if (drugMasterCount > 0 && packageCoveragePercent < packageCoverageThreshold) {
      await notifyAdmins({
        title: '医薬品包装マスター不足',
        message: `包装GTIN/JANマスターの紐づき率が${packageCoveragePercent}%です（${packageLinkedDrugMasterCount}/${drugMasterCount}件、閾値: ${packageCoverageThreshold}%）。HOTまたはDrugPackage取込の実行状況を確認してください`,
        link: '/admin/drug-masters',
        dedupeKey: `drug-package-coverage:${dedupeDate}`,
      });
      alertCount++;
    }

    return { processedCount: alertCount };
  });
}

const SOURCE_LABELS: Partial<Record<ImportSource, string>> = {
  ssk: 'SSK基本マスター',
  mhlw_price: 'MHLW薬価リスト',
  mhlw_generic: 'MHLW一般名処方マスタ',
  hot: 'MEDIS HOTコードマスター',
  pmda: 'PMDA添付文書',
  manual_clinical: '手動臨床ルール',
};
