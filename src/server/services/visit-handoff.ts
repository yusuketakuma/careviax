import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import type { RequestAuthContext } from '@/lib/auth/request-context';
import type { HandoffData, StructuredSoap } from '@/types/structured-soap';
import type { VisitHandoff } from '@/types/visit-brief';
import { extractHandoffFromSoap } from './visit-brief-ai';
import { upsertOperationalTask, resolveOperationalTasks } from './operational-tasks';

type DbClient = typeof prisma | Prisma.TransactionClient;

// ─── processHandoffExtraction ─────────────────────────────────────────────────

export async function processHandoffExtraction(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    patientId: string;
    patientName: string;
    structuredSoap: StructuredSoap;
    soapAssessment: string | null;
    soapPlan: string | null;
    requestContext?: RequestAuthContext;
  }
): Promise<VisitHandoff> {
  const {
    orgId,
    visitRecordId,
    patientName,
    structuredSoap,
    soapAssessment,
    soapPlan,
    requestContext,
  } = args;

  const result = await extractHandoffFromSoap({
    patientName,
    soapAssessment: soapAssessment ?? '',
    soapPlan: soapPlan ?? '',
    structuredAssessment: structuredSoap.assessment,
    structuredPlan: structuredSoap.plan,
    previousHandoff: structuredSoap.handoff ?? null,
  });

  const handoff: HandoffData = {
    next_check_items: result.next_check_items,
    ongoing_monitoring: result.ongoing_monitoring,
    decision_rationale: result.decision_rationale,
    ai_extracted: true,
    ai_confidence: result.confidence,
    confirmed_by: null,
    confirmed_at: null,
    extracted_at: result.extracted_at,
  };

  await withOrgContext(
    orgId,
    async (tx) => {
      const record = await tx.visitRecord.findUniqueOrThrow({
        where: { id: visitRecordId },
        select: { structured_soap: true },
      });

      const existing =
        record.structured_soap !== null &&
        typeof record.structured_soap === 'object' &&
        !Array.isArray(record.structured_soap)
          ? (record.structured_soap as Record<string, unknown>)
          : {};

      const updated: StructuredSoap = {
        ...(existing as StructuredSoap),
        handoff,
      };

      await tx.visitRecord.update({
        where: { id: visitRecordId },
        data: { structured_soap: updated as unknown as Prisma.InputJsonValue },
      });

      await upsertOperationalTask(tx, {
        orgId,
        taskType: 'handoff_confirmation',
        title: `申し送り確認: ${args.patientName}`,
        priority: 'normal',
        dedupeKey: `handoff_confirm_${visitRecordId}`,
        relatedEntityType: 'visit_record',
        relatedEntityId: visitRecordId,
      });
    },
    { requestContext }
  );

  return handoff;
}

// ─── confirmHandoff ───────────────────────────────────────────────────────────

export async function confirmHandoff(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    confirmedBy: string;
    edits?: Partial<
      Pick<VisitHandoff, 'next_check_items' | 'ongoing_monitoring' | 'decision_rationale'>
    >;
    requestContext?: RequestAuthContext;
  }
): Promise<VisitHandoff> {
  const { orgId, visitRecordId, confirmedBy, edits, requestContext } = args;

  let confirmed: HandoffData | null = null;

  await withOrgContext(
    orgId,
    async (tx) => {
      const record = await tx.visitRecord.findUniqueOrThrow({
        where: { id: visitRecordId },
        select: { structured_soap: true },
      });

      const existing =
        record.structured_soap !== null &&
        typeof record.structured_soap === 'object' &&
        !Array.isArray(record.structured_soap)
          ? (record.structured_soap as Record<string, unknown>)
          : {};

      const currentSoap = existing as StructuredSoap;
      const currentHandoff = currentSoap.handoff;

      if (!currentHandoff) {
        throw new Error(`No handoff found for visit record ${visitRecordId}`);
      }

      confirmed = {
        ...currentHandoff,
        ...(edits?.next_check_items !== undefined
          ? { next_check_items: edits.next_check_items }
          : {}),
        ...(edits?.ongoing_monitoring !== undefined
          ? { ongoing_monitoring: edits.ongoing_monitoring }
          : {}),
        ...(edits?.decision_rationale !== undefined
          ? { decision_rationale: edits.decision_rationale }
          : {}),
        confirmed_by: confirmedBy,
        confirmed_at: new Date().toISOString(),
      };

      const updated: StructuredSoap = {
        ...currentSoap,
        handoff: confirmed,
      };

      await tx.visitRecord.update({
        where: { id: visitRecordId },
        data: { structured_soap: updated as unknown as Prisma.InputJsonValue },
      });

      await resolveOperationalTasks(tx, {
        orgId,
        dedupeKey: `handoff_confirm_${visitRecordId}`,
        taskType: 'handoff_confirmation',
      });
    },
    { requestContext }
  );

  if (!confirmed) {
    throw new Error(`confirmHandoff: update did not complete for visit record ${visitRecordId}`);
  }

  return confirmed;
}
