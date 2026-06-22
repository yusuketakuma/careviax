import type { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import {
  findPatientDuplicateCandidates,
  parsePatientDuplicateBirthDate,
} from '@/lib/patient/duplicate-detection';
import type { CreateReferralInput } from '@/lib/validations/referral';

const DOCUMENT_TOTAL = 4;

type ReferralDocumentChecklist = {
  physician_order: boolean;
  consent: boolean;
  health_insurance: boolean;
  care_insurance: boolean;
};

export class ReferralIntakeValidationError extends Error {
  constructor() {
    super('invalid referral intake input');
    this.name = 'ReferralIntakeValidationError';
  }
}

export class ReferralIntakeTransactionError extends Error {
  constructor() {
    super('referral intake transaction failed');
    this.name = 'ReferralIntakeTransactionError';
  }
}

export type ReferralDuplicateSummary = {
  id: string;
};

export type CreateReferralIntakeResult =
  | {
      status: 'duplicate';
      duplicate_count: number;
      duplicates: ReferralDuplicateSummary[];
    }
  | {
      status: 'created';
      patient: { id: string };
      case: { id: string };
      warnings: Array<{
        code: 'PATIENT_DUPLICATE_ACKNOWLEDGED';
        severity: 'warning';
        message: string;
      }>;
      metadata: {
        duplicate_count: number;
      };
    };

function optionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function buildDocumentChecklist(input: CreateReferralInput): ReferralDocumentChecklist {
  return {
    physician_order: input.doc_physician_order,
    consent: input.doc_consent,
    health_insurance: input.doc_health_insurance,
    care_insurance: input.doc_care_insurance,
  };
}

function countReceivedDocuments(checklist: ReferralDocumentChecklist) {
  return Object.values(checklist).filter((received) => received).length;
}

export function buildReferralRequiredVisitSupport(
  existing: Record<string, unknown> | null | undefined,
  input: CreateReferralInput,
) {
  const checklist = buildDocumentChecklist(input);
  return {
    ...(existing ?? {}),
    referral_intake: {
      schema_version: 1,
      referral_type: input.referral_type,
      document_checklist: checklist,
      document_received_count: countReceivedDocuments(checklist),
      document_total: DOCUMENT_TOTAL,
    },
  };
}

export function buildReferralAuditChanges(
  input: CreateReferralInput,
  args: { patientId: string; caseId: string },
) {
  const checklist = buildDocumentChecklist(input);
  return {
    patient_id: args.patientId,
    case_id: args.caseId,
    referral_type: input.referral_type,
    document_checklist: checklist,
    document_received_count: countReceivedDocuments(checklist),
    document_total: DOCUMENT_TOTAL,
    has_referral_source: optionalString(input.referral_source) != null,
    has_referral_date: input.referral_date != null,
    has_referral_notes: optionalString(input.referral_notes) != null,
    has_phone: optionalString(input.phone) != null,
    has_address: optionalString(input.address) != null,
    has_medical_insurance_number: optionalString(input.medical_insurance_number) != null,
    has_care_insurance_number: optionalString(input.care_insurance_number) != null,
  } satisfies Prisma.InputJsonObject;
}

function summarizeDuplicates(
  duplicates: Awaited<ReturnType<typeof findPatientDuplicateCandidates>>,
): ReferralDuplicateSummary[] {
  return duplicates.map((duplicate) => ({ id: duplicate.id }));
}

async function createReferralIntakeInTransaction(ctx: AuthContext, input: CreateReferralInput) {
  return withOrgContext(
    ctx.orgId,
    async (tx) => {
      const patient = await tx.patient.create({
        data: {
          org_id: ctx.orgId,
          name: input.name,
          name_kana: input.name_kana,
          birth_date: new Date(input.birth_date),
          gender: input.gender,
          phone: optionalString(input.phone),
          medical_insurance_number: optionalString(input.medical_insurance_number),
          care_insurance_number: optionalString(input.care_insurance_number),
        },
      });

      const insuranceRecords: Prisma.PatientInsuranceCreateManyInput[] = [];
      if (optionalString(input.medical_insurance_number)) {
        insuranceRecords.push({
          org_id: ctx.orgId,
          patient_id: patient.id,
          insurance_type: 'medical',
          number: optionalString(input.medical_insurance_number),
          is_active: true,
        });
      }
      if (optionalString(input.care_insurance_number)) {
        insuranceRecords.push({
          org_id: ctx.orgId,
          patient_id: patient.id,
          insurance_type: 'care',
          number: optionalString(input.care_insurance_number),
          is_active: true,
        });
      }
      if (insuranceRecords.length > 0) {
        await tx.patientInsurance.createMany({ data: insuranceRecords });
      }

      const address = optionalString(input.address);
      if (address) {
        await tx.residence.create({
          data: {
            org_id: ctx.orgId,
            patient_id: patient.id,
            address,
            is_primary: true,
          },
        });
      }

      const careCase = await tx.careCase.create({
        data: {
          org_id: ctx.orgId,
          patient_id: patient.id,
          referral_source: optionalString(input.referral_source),
          referral_date: input.referral_date ? new Date(input.referral_date) : null,
          notes: optionalString(input.referral_notes),
          required_visit_support: toPrismaJsonInput(
            buildReferralRequiredVisitSupport(undefined, input),
          ),
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'referral_intake_create',
        targetType: 'CareCase',
        targetId: careCase.id,
        patientId: patient.id,
        changes: buildReferralAuditChanges(input, { patientId: patient.id, caseId: careCase.id }),
      });

      return {
        patient: { id: patient.id },
        case: { id: careCase.id },
      };
    },
    { requestContext: ctx },
  );
}

export async function createReferralIntake(
  ctx: AuthContext,
  input: CreateReferralInput,
): Promise<CreateReferralIntakeResult> {
  const birthDate = parsePatientDuplicateBirthDate(input.birth_date);
  if (!birthDate) {
    throw new ReferralIntakeValidationError();
  }

  const duplicates = await findPatientDuplicateCandidates(prisma, {
    orgId: ctx.orgId,
    name: input.name,
    birthDate,
    gender: input.gender,
    access: {
      userId: ctx.userId,
      role: ctx.role,
    },
  });

  if (duplicates.length > 0 && input.duplicate_acknowledged !== true) {
    return {
      status: 'duplicate',
      duplicate_count: duplicates.length,
      duplicates: summarizeDuplicates(duplicates),
    };
  }

  let created: Awaited<ReturnType<typeof createReferralIntakeInTransaction>>;
  try {
    created = await createReferralIntakeInTransaction(ctx, input);
  } catch {
    throw new ReferralIntakeTransactionError();
  }

  return {
    status: 'created',
    ...created,
    warnings:
      duplicates.length > 0
        ? [
            {
              code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
              severity: 'warning',
              message: '重複候補を確認済みとして紹介受付を登録しました。',
            },
          ]
        : [],
    metadata: {
      duplicate_count: duplicates.length,
    },
  };
}
