import type { Prisma } from '@prisma/client';

export type PatientInsuranceOverlapType = 'medical' | 'care' | 'public_subsidy';

export type BuildPatientInsuranceOverlapWhereArgs = {
  orgId: string;
  patientId: string;
  excludeInsuranceId?: string;
  insuranceType: PatientInsuranceOverlapType;
  publicProgramCode?: string | null;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
};

function normalizeBoundary(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export function buildPatientInsuranceOverlapWhere(
  args: BuildPatientInsuranceOverlapWhereArgs,
): Prisma.PatientInsuranceWhereInput {
  const validFrom = normalizeBoundary(args.validFrom);
  const validUntil = normalizeBoundary(args.validUntil);
  const intervalConditions: Prisma.PatientInsuranceWhereInput[] = [];

  if (validUntil) {
    intervalConditions.push({
      OR: [{ valid_from: null }, { valid_from: { lte: validUntil } }],
    });
  }

  if (validFrom) {
    intervalConditions.push({
      OR: [{ valid_until: null }, { valid_until: { gte: validFrom } }],
    });
  }

  return {
    org_id: args.orgId,
    patient_id: args.patientId,
    insurance_type: args.insuranceType,
    is_active: true,
    ...(args.excludeInsuranceId ? { id: { not: args.excludeInsuranceId } } : {}),
    ...(args.insuranceType === 'public_subsidy' && args.publicProgramCode
      ? { public_program_code: args.publicProgramCode }
      : {}),
    ...(intervalConditions.length > 0 ? { AND: intervalConditions } : {}),
  };
}
