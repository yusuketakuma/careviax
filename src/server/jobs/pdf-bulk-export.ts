import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { cleanupExpiredGeneratedFiles } from '@/server/services/file-storage';
import { drainMedicationHistoryBulkExportQueue } from '@/server/services/pdf-bulk-export';

const BULK_EXPORT_ORG_PAGE_SIZE = 100;

export async function listMedicationHistoryBulkExportOrgIds(
  client: Pick<PrismaClient, 'organization'>,
) {
  const orgIds: string[] = [];
  let cursor: string | undefined;

  for (;;) {
    const organizations = await client.organization.findMany({
      orderBy: { id: 'asc' },
      take: BULK_EXPORT_ORG_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });

    orgIds.push(...organizations.map(({ id }) => id));
    if (organizations.length < BULK_EXPORT_ORG_PAGE_SIZE) break;
    cursor = organizations.at(-1)?.id;
  }

  return orgIds;
}

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
