import { subHours } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { runJob } from '../runner';
import { withOrgContext } from '@/lib/db/rls';
import { listOrganizationIds } from '../organization-iteration';

const QR_DRAFT_CLEANUP_BATCH_SIZE = 100;

export async function cleanupAbandonedQrDrafts() {
  return runJob('cleanup_abandoned_qr_drafts', async () => {
    const cutoff = subHours(new Date(), 24);
    const orgIds = await listOrganizationIds(prisma);
    let processedCount = 0;

    for (const orgId of orgIds) {
      for (;;) {
        const batch = await withOrgContext(
          orgId,
          async (tx) => {
            const abandonedDrafts = await tx.qrScanDraft.findMany({
              where: {
                org_id: orgId,
                status: 'pending',
                created_at: { lt: cutoff },
              },
              orderBy: { id: 'asc' },
              take: QR_DRAFT_CLEANUP_BATCH_SIZE,
              select: { id: true },
            });
            const abandonedDraftIds = abandonedDrafts.map((draft) => draft.id);
            if (abandonedDraftIds.length === 0) {
              return { selectedCount: 0, updatedCount: 0 };
            }

            const result = await tx.qrScanDraft.updateMany({
              where: {
                org_id: orgId,
                id: { in: abandonedDraftIds },
                status: 'pending',
              },
              data: {
                status: 'discarded',
                raw_qr_texts: [],
                qr_payload_hash: null,
                parsed_data: {
                  discarded: true,
                  discarded_by: 'cleanup_abandoned_qr_drafts',
                  discarded_at: new Date().toISOString(),
                },
                parse_errors: Prisma.JsonNull,
                auto_completed: Prisma.JsonNull,
                expected_qr_count: null,
              },
            });
            await tx.jahisSupplementalRecord.deleteMany({
              where: {
                org_id: orgId,
                qr_draft_id: { in: abandonedDraftIds },
                prescription_intake_id: null,
              },
            });
            return { selectedCount: abandonedDraftIds.length, updatedCount: result.count };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        processedCount += batch.updatedCount;
        if (batch.selectedCount < QR_DRAFT_CLEANUP_BATCH_SIZE) break;
      }
    }

    if (processedCount > 0) {
      logger.info('[daily] discarded abandoned QR scan drafts', { count: processedCount });
    }
    return { processedCount };
  });
}

export async function cleanupTerminalQrDraftPayloads() {
  return runJob('cleanup_terminal_qr_draft_payloads', async () => {
    const scrubbedAt = new Date().toISOString();
    const orgIds = await listOrganizationIds(prisma);
    let processedCount = 0;
    for (const orgId of orgIds) {
      const result = await withOrgContext(orgId, (tx) =>
        tx.qrScanDraft.updateMany({
          where: {
            org_id: orgId,
            status: { in: ['confirmed', 'discarded'] },
          },
          data: {
            raw_qr_texts: [],
            qr_payload_hash: null,
            parsed_data: {
              scrubbed: true,
              scrubbed_by: 'cleanup_terminal_qr_draft_payloads',
              scrubbed_at: scrubbedAt,
            },
            parse_errors: Prisma.JsonNull,
            auto_completed: Prisma.JsonNull,
            expected_qr_count: null,
          },
        }),
      );
      processedCount += result.count;
    }

    if (processedCount > 0) {
      logger.info('[daily] scrubbed terminal QR scan draft payloads', { count: processedCount });
    }

    return { processedCount };
  });
}
