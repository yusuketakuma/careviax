import { drainYreseClinicalSyncQueue } from '@/server/services/standard-clinical-sync-queue';
import { purgeExpiredClinicalFhirRawResourceVault } from '@/server/services/standard-clinical-raw-vault-retention';
import { runJob } from './runner';

type YreseClinicalSyncQueueDrainJobContext = {
  orgId?: string;
};

export function drainYreseClinicalSyncQueueJob(
  context: YreseClinicalSyncQueueDrainJobContext = {},
) {
  return runJob(
    'yrese_clinical_sync_queue_drain',
    async () => {
      if (!context.orgId) {
        return {
          processedCount: 0,
          scannedCount: 0,
          errors: ['org_scope_required'],
        };
      }
      return drainYreseClinicalSyncQueue({ orgId: context.orgId });
    },
    context.orgId,
  );
}

type ClinicalRawVaultRetentionPurgeJobContext = {
  orgId?: string;
};

export function purgeExpiredClinicalFhirRawResourceVaultJob(
  context: ClinicalRawVaultRetentionPurgeJobContext = {},
) {
  return runJob(
    'clinical_fhir_raw_vault_retention_purge',
    async () => {
      if (!context.orgId) {
        return {
          processedCount: 0,
          deletedCount: 0,
          scannedCount: 0,
          errors: ['org_scope_required'],
        };
      }
      return purgeExpiredClinicalFhirRawResourceVault({ orgId: context.orgId });
    },
    context.orgId,
  );
}
