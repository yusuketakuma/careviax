import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import type { RequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import type { HandoffData, StructuredSoap } from '@/types/structured-soap';
import type { VisitHandoff } from '@/types/visit-brief';
import { extractHandoffFromSoap } from './visit-brief-ai';
import { upsertOperationalTask, resolveOperationalTasks } from './operational-tasks';

type DbClient = typeof prisma | Prisma.TransactionClient;

export const VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE =
  '申し送り抽出に失敗しました。時間をおいて再実行してください';

export class VisitHandoffStaleRecordError extends Error {
  constructor(visitRecordId: string) {
    super(`Visit record ${visitRecordId} changed before handoff extraction could be saved`);
  }
}

function readStructuredSoap(value: unknown): Partial<StructuredSoap> {
  return readJsonObject(value) ?? {};
}

function readHandoffData(value: unknown): HandoffData | null {
  const handoff = readJsonObject(value);
  return handoff as HandoffData | null;
}

export function normalizeStructuredSoapForVisitRecordSave(
  structuredSoap: unknown,
  existingStructuredSoap?: unknown,
): unknown {
  const soap = readJsonObject(structuredSoap);
  if (!soap) return structuredSoap;

  const existingHandoff = readHandoffData(readStructuredSoap(existingStructuredSoap).handoff);
  if (existingHandoff) {
    return {
      ...soap,
      handoff: existingHandoff,
    };
  }

  const handoff = readJsonObject(soap.handoff);
  if (!handoff) return soap;

  return {
    ...soap,
    handoff: {
      ...handoff,
      ai_extracted: false,
      ai_confidence: null,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: null,
    },
  };
}

async function saveHandoffExtractionStatus(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    expectedVersion?: number | null;
    status: 'extracting' | 'succeeded' | 'failed';
    message?: string | null;
    requestContext?: RequestAuthContext;
  },
): Promise<boolean> {
  return withOrgContext(
    args.orgId,
    async (tx) => {
      const record = await tx.visitRecord.findUniqueOrThrow({
        where: { id: args.visitRecordId },
        select: { schedule_id: true, version: true, updated_at: true },
      });
      const expectedVersion = args.expectedVersion ?? record.version;
      if (record.version !== expectedVersion) return false;

      const now = new Date();
      await tx.visitHandoffExtraction.upsert({
        where: { visit_record_id: args.visitRecordId },
        create: {
          org_id: args.orgId,
          visit_record_id: args.visitRecordId,
          schedule_id: record.schedule_id,
          source_visit_record_version: record.version,
          source_visit_record_updated_at: record.updated_at,
          status: args.status,
          retry_count: args.status === 'failed' ? 1 : 0,
          last_attempted_at: now,
          last_succeeded_at: args.status === 'succeeded' ? now : null,
          last_failed_at: args.status === 'failed' ? now : null,
          error_message: args.status === 'failed' ? (args.message ?? null) : null,
          retryable: args.status === 'failed',
        },
        update: {
          source_visit_record_version: record.version,
          source_visit_record_updated_at: record.updated_at,
          status: args.status,
          ...(args.status === 'failed' ? { retry_count: { increment: 1 } } : {}),
          last_attempted_at: now,
          last_succeeded_at: args.status === 'succeeded' ? now : undefined,
          last_failed_at: args.status === 'failed' ? now : undefined,
          error_message: args.status === 'failed' ? (args.message ?? null) : null,
          retryable: args.status === 'failed',
        },
      });
      return true;
    },
    { requestContext: args.requestContext },
  );
}

export async function markHandoffExtractionFailed(
  _db: DbClient,
  args: {
    orgId: string;
    visitRecordId: string;
    expectedVersion?: number | null;
    requestContext?: RequestAuthContext;
  },
): Promise<boolean> {
  return saveHandoffExtractionStatus(_db, {
    orgId: args.orgId,
    visitRecordId: args.visitRecordId,
    expectedVersion: args.expectedVersion,
    requestContext: args.requestContext,
    status: 'failed',
    message: VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE,
  });
}

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
    expectedVersion?: number | null;
    requestContext?: RequestAuthContext;
  },
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

  const claimedExtraction = await saveHandoffExtractionStatus(_db, {
    orgId,
    visitRecordId,
    expectedVersion: args.expectedVersion,
    requestContext,
    status: 'extracting',
  });
  if (!claimedExtraction) {
    throw new VisitHandoffStaleRecordError(visitRecordId);
  }

  let result;
  try {
    result = await extractHandoffFromSoap({
      patientName,
      soapAssessment: soapAssessment ?? '',
      soapPlan: soapPlan ?? '',
      structuredAssessment: structuredSoap.assessment,
      structuredPlan: structuredSoap.plan,
      previousHandoff: structuredSoap.handoff ?? null,
    });
  } catch (cause) {
    await markHandoffExtractionFailed(_db, {
      orgId,
      visitRecordId,
      expectedVersion: args.expectedVersion,
      requestContext,
    });
    throw cause;
  }

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

  try {
    await withOrgContext(
      orgId,
      async (tx) => {
        const record = await tx.visitRecord.findUniqueOrThrow({
          where: { id: visitRecordId },
          select: { structured_soap: true, version: true },
        });
        const expectedVersion = args.expectedVersion ?? record.version;

        const existing = readStructuredSoap(record.structured_soap);

        const updated = {
          ...existing,
          handoff,
        };

        const claim = await tx.visitRecord.updateMany({
          where: { id: visitRecordId, version: expectedVersion },
          data: {
            structured_soap: toPrismaJsonInput(updated),
          },
        });
        if (claim.count !== 1) {
          throw new VisitHandoffStaleRecordError(visitRecordId);
        }

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
      { requestContext },
    );
    await saveHandoffExtractionStatus(_db, {
      orgId,
      visitRecordId,
      expectedVersion: args.expectedVersion,
      requestContext,
      status: 'succeeded',
    });
  } catch (cause) {
    if (cause instanceof VisitHandoffStaleRecordError) throw cause;
    await markHandoffExtractionFailed(_db, {
      orgId,
      visitRecordId,
      expectedVersion: args.expectedVersion,
      requestContext,
    });
    throw cause;
  }

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
    expectedVersion: number;
    requestContext?: RequestAuthContext;
  },
): Promise<VisitHandoff> {
  const { orgId, visitRecordId, confirmedBy, edits, expectedVersion, requestContext } = args;

  let confirmed: HandoffData | null = null;

  await withOrgContext(
    orgId,
    async (tx) => {
      const record = await tx.visitRecord.findUniqueOrThrow({
        where: { id: visitRecordId },
        select: { structured_soap: true, version: true },
      });

      if (record.version !== expectedVersion) {
        throw new VisitHandoffStaleRecordError(visitRecordId);
      }

      const currentSoap = readStructuredSoap(record.structured_soap);
      const currentHandoff = readHandoffData(currentSoap.handoff);

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

      const updated = {
        ...currentSoap,
        handoff: confirmed,
      };

      const claim = await tx.visitRecord.updateMany({
        where: { id: visitRecordId, version: expectedVersion },
        data: {
          structured_soap: toPrismaJsonInput(updated),
          version: { increment: 1 },
        },
      });
      if (claim.count !== 1) {
        throw new VisitHandoffStaleRecordError(visitRecordId);
      }

      await resolveOperationalTasks(tx, {
        orgId,
        dedupeKey: `handoff_confirm_${visitRecordId}`,
        taskType: 'handoff_confirmation',
      });
    },
    { requestContext },
  );

  if (!confirmed) {
    throw new Error(`confirmHandoff: update did not complete for visit record ${visitRecordId}`);
  }

  return confirmed;
}
