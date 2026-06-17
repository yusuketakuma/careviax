import { prisma } from '@/lib/db';
import { importCareServiceOfficeOpenData } from '@/server/services/care-service-office-master-import';
import { runJob } from './runner';

type RefreshCareServiceOfficeMasterOptions = {
  targetOrgIds?: string[];
};

export async function refreshCareServiceOfficeMaster(
  options: RefreshCareServiceOfficeMasterOptions = {},
) {
  const targetOrgIds = options.targetOrgIds
    ? [...new Set(options.targetOrgIds.filter(Boolean))].sort()
    : undefined;
  const dedupeKey =
    targetOrgIds && targetOrgIds.length > 0 ? `target-orgs:${targetOrgIds.join(',')}` : 'all-orgs';

  return runJob(
    'care_service_office_master_auto_refresh',
    async () => {
      return importCareServiceOfficeOpenData(prisma, {
        targetOrgIds,
      });
    },
    targetOrgIds?.length === 1 ? targetOrgIds[0] : undefined,
    dedupeKey,
  );
}
