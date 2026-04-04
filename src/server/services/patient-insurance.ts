import type { PrismaClient, InsuranceType } from '@prisma/client';

/**
 * Resolves the effective PatientInsurance record for a given patient, type, and reference date.
 * Returns the most recently active record whose validity window covers `asOf`.
 */
export async function resolvePatientInsurance(
  prisma: PrismaClient,
  args: {
    orgId: string;
    patientId: string;
    type: InsuranceType;
    asOf?: Date;
  }
) {
  const asOf = args.asOf ?? new Date();
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);

  const record = await prisma.patientInsurance.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      insurance_type: args.type,
      is_active: true,
      OR: [{ valid_from: null }, { valid_from: { lte: today } }],
      AND: [{ OR: [{ valid_until: null }, { valid_until: { gte: today } }] }],
    },
    orderBy: [{ valid_from: 'desc' }, { created_at: 'desc' }],
  });

  return record;
}
