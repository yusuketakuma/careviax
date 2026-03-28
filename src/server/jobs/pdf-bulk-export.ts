import { drainMedicationHistoryBulkExportQueue } from '@/server/services/pdf-bulk-export';

export async function drainMedicationHistoryBulkExportJobs() {
  return drainMedicationHistoryBulkExportQueue();
}
