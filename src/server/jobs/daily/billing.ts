import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import { upsertBillingEvidenceForVisit } from '@/server/services/billing-evidence';

export async function generateBillingEvidenceDaily() {
  return runJob('billing_evidence_generation', async () => {
    const existingEvidence = await prisma.billingEvidence.findMany({
      select: {
        visit_record_id: true,
      },
    });
    const existingVisitRecordIds = existingEvidence.map((record) => record.visit_record_id);

    const visitRecords = await prisma.visitRecord.findMany({
      where: {
        ...(existingVisitRecordIds.length > 0 ? { id: { notIn: existingVisitRecordIds } } : {}),
      },
      select: {
        id: true,
        org_id: true,
      },
    });

    for (const visitRecord of visitRecords) {
      await withOrgContext(visitRecord.org_id, (tx) =>
        upsertBillingEvidenceForVisit(tx, {
          orgId: visitRecord.org_id,
          visitRecordId: visitRecord.id,
        }),
      );
    }

    return { processedCount: visitRecords.length };
  });
}
