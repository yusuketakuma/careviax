import { prisma } from '@/lib/db';
import {
  importGenericNameMappings,
  importMhlwGenericFlags,
  importMhlwPriceList,
} from '@/server/services/drug-master-import/mhlw';
import {
  importPmdaPackageInserts,
} from '@/server/services/drug-master-import/pmda';
import {
  importSskDrugMaster,
  resolveLatestSskDrugMasterZipUrl,
  SSK_DRUG_MASTER_PAGE_URL,
} from '@/server/services/drug-master-import/ssk';
import type { ImportSource } from '@prisma/client';
import { runJob } from './runner';

// ── Freshness thresholds (days) ──

const FRESHNESS_THRESHOLDS: Record<ImportSource, number> = {
  ssk: 45,              // SSK: monthly → alert after 45 days
  mhlw_price: 120,      // MHLW price: annual + mid-year → alert after 120 days
  mhlw_generic: 120,    // MHLW generic: same cycle as price
  hot: 60,              // HOT: monthly → alert after 60 days (disabled until licensed)
  pmda: 14,             // PMDA: daily delta → alert after 14 days
  manual_clinical: 365, // Manual: annual review
};

/** Sources that are free and require no registration */
const FREE_SOURCES: ImportSource[] = ['ssk', 'mhlw_price', 'mhlw_generic'];

async function resolveLatestZipUrl(fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(SSK_DRUG_MASTER_PAGE_URL, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) {
    throw new Error(`SSKページの取得に失敗しました: ${response.status}`);
  }

  const html = await response.text();
  return resolveLatestSskDrugMasterZipUrl(html, SSK_DRUG_MASTER_PAGE_URL);
}

export async function refreshSskDrugMaster() {
  const latestZipUrl = await resolveLatestZipUrl();

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
      if (latestCompletedJob?.dedupe_key === latestZipUrl) {
        return {
          processedCount: 0,
          errors: [],
        };
      }

      const result = await importSskDrugMaster(prisma, { zipUrl: latestZipUrl });
      return {
        processedCount: result.importedCount,
      };
    },
    undefined,
    latestZipUrl
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
        priceResult.importedCount +
        genericFlagsResult.importedCount +
        mappingResult.importedCount,
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

        // Create notifications for all admin users across all orgs
        const adminMemberships = await prisma.membership.findMany({
          where: { role: { in: ['admin', 'owner'] }, is_active: true },
          select: { user_id: true, org_id: true },
        });

        for (const admin of adminMemberships) {
          await prisma.notification.create({
            data: {
              org_id: admin.org_id,
              user_id: admin.user_id,
              type: 'system',
              title: '医薬品マスター更新遅延',
              message,
              link: '/admin/drug-masters',
              dedupe_key: `drug-master-stale:${source}:${now.toISOString().slice(0, 10)}`,
            },
          });
        }
        alertCount++;
      }
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
