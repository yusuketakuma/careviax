import {
  ClinicalExternalReferenceStatus,
  ClinicalLocalResourceType,
  ClinicalMatchConfidence,
  ClinicalQueueStatus,
  ClinicalIntegrationDirection,
  type Prisma,
  Prisma as PrismaNamespace,
} from '@prisma/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { FHIR_R4_VERSION, JP_CORE_VERSION } from '@/server/adapters/fhir';

type PatientLinkageTx = Pick<
  Prisma.TransactionClient,
  | 'clinicalExternalReference'
  | 'clinicalFhirResourceCache'
  | 'clinicalSyncQueueItem'
  | 'clinicalProvenanceRecord'
>;

export interface VerifyClinicalExternalReferencePatientLinkInput {
  readonly orgId: string;
  readonly patientId: string;
  readonly externalReferenceId: string;
  readonly verifiedByUserId: string;
}

export interface VerifyClinicalExternalReferencePatientLinkResult {
  readonly externalReferenceId: string;
  readonly patientId: string;
  readonly updatedCacheCount: number;
  readonly requeuedQueueItemCount: number;
  readonly provenanceRecordId: string | null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    return error.code === 'P2002';
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

async function createOrFindLinkageProvenance(args: {
  readonly tx: PatientLinkageTx;
  readonly orgId: string;
  readonly patientId: string;
  readonly externalReferenceId: string;
  readonly verifiedByUserId: string;
}) {
  try {
    return await args.tx.clinicalProvenanceRecord.create({
      data: {
        org_id: args.orgId,
        subject_type: ClinicalLocalResourceType.patient,
        subject_id: args.patientId,
        activity: 'clinical_external_reference.patient_link_verified',
        direction: ClinicalIntegrationDirection.inbound,
        external_reference_id: args.externalReferenceId,
        input_hash: args.externalReferenceId,
        output_hash: args.patientId,
        recorded_by: args.verifiedByUserId,
        adapter_version: 'standard-clinical-patient-linkage.v1',
        jp_core_version: JP_CORE_VERSION,
        fhir_version: FHIR_R4_VERSION,
        transformation_summary: toPrismaJsonInput({
          verification: 'manual',
          raw_storage: 'not_persisted',
        }),
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return args.tx.clinicalProvenanceRecord.findFirst({
      where: {
        org_id: args.orgId,
        subject_type: ClinicalLocalResourceType.patient,
        subject_id: args.patientId,
        activity: 'clinical_external_reference.patient_link_verified',
        input_hash: args.externalReferenceId,
      },
      select: { id: true },
    });
  }
}

export async function verifyClinicalExternalReferencePatientLink(
  tx: PatientLinkageTx,
  input: VerifyClinicalExternalReferencePatientLinkInput,
): Promise<VerifyClinicalExternalReferencePatientLinkResult | null> {
  const reference = await tx.clinicalExternalReference.findFirst({
    where: {
      id: input.externalReferenceId,
      org_id: input.orgId,
      status: { not: ClinicalExternalReferenceStatus.retired },
    },
    select: { id: true },
  });
  if (!reference) return null;

  await tx.clinicalExternalReference.update({
    where: { id_org_id: { id: input.externalReferenceId, org_id: input.orgId } },
    data: {
      patient_id: input.patientId,
      local_resource_type: ClinicalLocalResourceType.patient,
      local_resource_id: input.patientId,
      status: ClinicalExternalReferenceStatus.verified,
      confidence: ClinicalMatchConfidence.verified_manual,
      last_seen_at: new Date(),
    },
  });

  const cacheUpdate = await tx.clinicalFhirResourceCache.updateMany({
    where: {
      org_id: input.orgId,
      external_reference_id: input.externalReferenceId,
    },
    data: { patient_id: input.patientId },
  });

  const queueUpdate = await tx.clinicalSyncQueueItem.updateMany({
    where: {
      org_id: input.orgId,
      external_reference_id: input.externalReferenceId,
      status: ClinicalQueueStatus.conflict_requires_review,
      last_error_code: 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
    },
    data: {
      status: ClinicalQueueStatus.pending,
      next_attempt_at: new Date(),
      locked_at: null,
      locked_by: null,
      completed_at: null,
      last_error_code: null,
      last_error_metadata: PrismaNamespace.JsonNull,
    },
  });

  const provenance = await createOrFindLinkageProvenance({
    tx,
    orgId: input.orgId,
    patientId: input.patientId,
    externalReferenceId: input.externalReferenceId,
    verifiedByUserId: input.verifiedByUserId,
  });

  return {
    externalReferenceId: input.externalReferenceId,
    patientId: input.patientId,
    updatedCacheCount: cacheUpdate.count,
    requeuedQueueItemCount: queueUpdate.count,
    provenanceRecordId: provenance?.id ?? null,
  };
}
