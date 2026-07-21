import type { Prisma, InsuranceType } from '@prisma/client';
import { KEY_LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';

export const OPERATIONAL_INSURANCE_TYPES: InsuranceType[] = ['medical', 'care', 'public_subsidy'];
export const OPERATIONAL_LAB_ANALYTE_CODES = [...KEY_LAB_ANALYTE_CODES];

export function buildPatientOperationalInsuranceRelation(orgId: string) {
  return {
    where: {
      org_id: orgId,
      insurance_type: { in: OPERATIONAL_INSURANCE_TYPES },
    },
    orderBy: [
      { is_active: 'desc' as const },
      { valid_from: 'desc' as const },
      { created_at: 'desc' as const },
      { id: 'desc' as const },
    ],
    take: 6,
    select: {
      insurance_type: true,
      application_status: true,
      public_program_code: true,
      copay_ratio: true,
      valid_from: true,
      valid_until: true,
      is_active: true,
    },
  } as const satisfies Prisma.Patient$insurancesArgs;
}

export function buildPatientOperationalLabRelation(orgId: string) {
  return {
    where: {
      org_id: orgId,
      analyte_code: { in: OPERATIONAL_LAB_ANALYTE_CODES },
    },
    orderBy: [{ measured_at: 'desc' as const }, { id: 'desc' as const }],
    take: 6,
    select: {
      analyte_code: true,
      value_numeric: true,
      value_text: true,
      unit: true,
      measured_at: true,
      abnormal_flag: true,
    },
  } as const satisfies Prisma.Patient$lab_observationsArgs;
}

export function buildPatientOperationalSummarySelect(orgId: string) {
  return {
    archived_at: true,
    allergy_info: true,
    insurances: buildPatientOperationalInsuranceRelation(orgId),
    lab_observations: buildPatientOperationalLabRelation(orgId),
  } as const satisfies Prisma.PatientSelect;
}
