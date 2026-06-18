import { subHours } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { runJob } from '../runner';

export async function cleanupAbandonedQrDrafts() {
  return runJob('cleanup_abandoned_qr_drafts', async () => {
    const cutoff = subHours(new Date(), 24);
    const abandonedDrafts = await prisma.qrScanDraft.findMany({
      where: {
        status: 'pending',
        created_at: { lt: cutoff },
      },
      select: { id: true },
    });
    const abandonedDraftIds = abandonedDrafts.map((draft) => draft.id);
    if (abandonedDraftIds.length === 0) return { processedCount: 0 };

    const result = await prisma.qrScanDraft.updateMany({
      where: {
        id: { in: abandonedDraftIds },
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
    await prisma.jahisSupplementalRecord.deleteMany({
      where: {
        qr_draft_id: { in: abandonedDraftIds },
        prescription_intake_id: null,
      },
    });
    if (result.count > 0) {
      logger.info('[daily] discarded abandoned QR scan drafts', { count: result.count });
    }
    return { processedCount: result.count };
  });
}

export async function cleanupTerminalQrDraftPayloads() {
  return runJob('cleanup_terminal_qr_draft_payloads', async () => {
    const scrubbedAt = new Date().toISOString();
    const result = await prisma.qrScanDraft.updateMany({
      where: {
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
    });

    if (result.count > 0) {
      logger.info('[daily] scrubbed terminal QR scan draft payloads', { count: result.count });
    }

    return { processedCount: result.count };
  });
}
