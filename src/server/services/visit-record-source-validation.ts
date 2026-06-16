import { Prisma } from '@prisma/client';
import { readJsonObject } from '@/lib/db/json';

export type VisitRecordSourceValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'source_not_found'
        | 'source_scope_mismatch'
        | 'source_revision_missing'
        | 'source_version_conflict';
      details?: {
        source_visit_record_id?: string;
        expected_version?: number | null;
        current_version?: number | null;
        expected_updated_at?: string | null;
        current_updated_at?: string | null;
      };
    };

function readPreviousVisitReuse(structuredSoap: unknown) {
  const soap = readJsonObject(structuredSoap);
  const reuse = readJsonObject(soap?.previous_visit_reuse);
  if (!reuse) return null;

  const sourceVisitRecordId = reuse.source_visit_record_id;
  if (typeof sourceVisitRecordId !== 'string' || sourceVisitRecordId.trim() === '') {
    return null;
  }

  const sourceVersion =
    typeof reuse.source_visit_record_version === 'number' &&
    Number.isInteger(reuse.source_visit_record_version)
      ? reuse.source_visit_record_version
      : null;
  const sourceUpdatedAt =
    typeof reuse.source_visit_record_updated_at === 'string'
      ? reuse.source_visit_record_updated_at
      : null;

  return {
    sourceVisitRecordId,
    sourceVersion,
    sourceUpdatedAt,
  };
}

export async function validatePreviousVisitReuseSource(args: {
  tx: Prisma.TransactionClient;
  orgId: string;
  patientId: string;
  caseId: string;
  structuredSoap: unknown;
}): Promise<VisitRecordSourceValidationResult> {
  const reuse = readPreviousVisitReuse(args.structuredSoap);
  if (!reuse) return { ok: true };

  await args.tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "VisitRecord" WHERE "id" = ${reuse.sourceVisitRecordId} AND "org_id" = ${args.orgId} FOR UPDATE`,
  );

  const source = await args.tx.visitRecord.findFirst({
    where: {
      id: reuse.sourceVisitRecordId,
      org_id: args.orgId,
    },
    select: {
      id: true,
      patient_id: true,
      version: true,
      updated_at: true,
      schedule: {
        select: {
          case_id: true,
        },
      },
    },
  });

  if (!source) {
    return {
      ok: false,
      reason: 'source_not_found',
      details: { source_visit_record_id: reuse.sourceVisitRecordId },
    };
  }

  if (source.patient_id !== args.patientId || source.schedule.case_id !== args.caseId) {
    return {
      ok: false,
      reason: 'source_scope_mismatch',
      details: { source_visit_record_id: reuse.sourceVisitRecordId },
    };
  }

  if (reuse.sourceVersion === null || reuse.sourceUpdatedAt === null) {
    return {
      ok: false,
      reason: 'source_revision_missing',
      details: {
        source_visit_record_id: reuse.sourceVisitRecordId,
        expected_version: reuse.sourceVersion,
        current_version: source.version,
        expected_updated_at: reuse.sourceUpdatedAt,
        current_updated_at: source.updated_at.toISOString(),
      },
    };
  }

  const currentUpdatedAt = source.updated_at.toISOString();
  const versionConflicts = source.version !== reuse.sourceVersion;
  const updatedAtConflicts = currentUpdatedAt !== reuse.sourceUpdatedAt;

  if (versionConflicts || updatedAtConflicts) {
    return {
      ok: false,
      reason: 'source_version_conflict',
      details: {
        source_visit_record_id: reuse.sourceVisitRecordId,
        expected_version: reuse.sourceVersion,
        current_version: source.version,
        expected_updated_at: reuse.sourceUpdatedAt,
        current_updated_at: currentUpdatedAt,
      },
    };
  }

  return { ok: true };
}
