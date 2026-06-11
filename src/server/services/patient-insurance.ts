import type { InsuranceApplicationStatus, InsuranceType } from '@prisma/client';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';

type PatientInsuranceReader = {
  patientInsurance: {
    findFirst(args: unknown): Promise<{
      id: string;
      number: string | null;
      insurance_type: InsuranceType;
      application_status: InsuranceApplicationStatus;
      public_program_code: string | null;
      previous_care_level: string | null;
      provisional_care_level: string | null;
      confirmed_care_level: string | null;
      is_active: boolean;
    } | null>;
  };
};

/**
 * Resolves the effective PatientInsurance record for a given patient, type, and reference date.
 * Returns the most recently active record whose validity window covers `asOf`.
 */
export async function resolvePatientInsurance(
  prisma: PatientInsuranceReader,
  args: {
    orgId: string;
    patientId: string;
    type: InsuranceType;
    asOf?: Date;
  },
) {
  const asOf = args.asOf ?? new Date();
  // valid_from / valid_until(@db.Date)は UTC 深夜で保存されるため UTC 深夜で比較する
  const today = utcDateFromLocalKey(localDateKey(asOf));

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
