import { cleanupExpiredGeneratedFiles } from '@/server/services/file-storage';
import { drainMedicationHistoryBulkExportQueue } from '@/server/services/pdf-bulk-export';

export async function drainMedicationHistoryBulkExportJobs(args?: { orgId?: string }) {
  return drainMedicationHistoryBulkExportQueue(args);
}

export async function cleanupExpiredBulkExportArtifacts(args?: { orgId?: string }) {
  return cleanupExpiredGeneratedFiles(args);
}
