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
import { runJob } from './runner';

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
