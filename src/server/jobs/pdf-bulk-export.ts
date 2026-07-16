import { prisma } from '@/lib/db/client';
import { cleanupExpiredGeneratedFiles } from '@/server/services/file-storage';
import { drainMedicationHistoryBulkExportQueue } from '@/server/services/pdf-bulk-export';
import { listOrganizationIds } from './organization-iteration';

export const listMedicationHistoryBulkExportOrgIds = listOrganizationIds;

export async function drainMedicationHistoryBulkExportJobs(args?: { orgId?: string }) {
  const orgIds = args?.orgId ? [args.orgId] : await listMedicationHistoryBulkExportOrgIds(prisma);
  const aggregate = { processedCount: 0, errors: [] as string[] };

  for (const orgId of orgIds) {
    try {
      const result = await drainMedicationHistoryBulkExportQueue({ orgId });
      aggregate.processedCount += result.processedCount;
      aggregate.errors.push(...result.errors);
    } catch {
      aggregate.errors.push('medication_history_bulk_export_org_drain_failed');
    }
  }

  return aggregate;
}

export async function cleanupExpiredBulkExportArtifacts(args?: { orgId?: string }) {
  return cleanupExpiredGeneratedFiles(args);
}
