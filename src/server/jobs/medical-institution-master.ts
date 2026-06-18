import { prisma } from '@/lib/db/client';
import { importMedicalInstitutionOpenData } from '@/server/services/medical-institution-master-import';
import { runJob } from './runner';

type RefreshMedicalInstitutionMasterOptions = {
  targetOrgIds?: string[];
};

export async function refreshMedicalInstitutionMaster(
  options: RefreshMedicalInstitutionMasterOptions = {},
) {
  const targetOrgIds = options.targetOrgIds
    ? [...new Set(options.targetOrgIds.filter(Boolean))].sort()
    : undefined;
  const dedupeKey =
    targetOrgIds && targetOrgIds.length > 0 ? `target-orgs:${targetOrgIds.join(',')}` : 'all-orgs';

  return runJob(
    'medical_institution_master_auto_refresh',
    async () => {
      return importMedicalInstitutionOpenData(prisma, {
        targetOrgIds,
      });
    },
    targetOrgIds?.length === 1 ? targetOrgIds[0] : undefined,
    dedupeKey,
  );
}
