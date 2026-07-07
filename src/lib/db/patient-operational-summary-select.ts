import type { Prisma, InsuranceType } from '@prisma/client';
import { KEY_LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';

const OPERATIONAL_INSURANCE_TYPES: InsuranceType[] = ['medical', 'care', 'public_subsidy'];
const OPERATIONAL_LAB_ANALYTE_CODES = [...KEY_LAB_ANALYTE_CODES];

export function buildPatientOperationalSummarySelect(orgId: string) {
  return {
    archived_at: true,
    allergy_info: true,
    insurances: {
      where: {
        org_id: orgId,
        insurance_type: { in: OPERATIONAL_INSURANCE_TYPES },
      },
      orderBy: [
        { is_active: 'desc' },
        { valid_from: 'desc' },
        { created_at: 'desc' },
        { id: 'desc' },
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
    },
    lab_observations: {
      where: {
        org_id: orgId,
        analyte_code: { in: OPERATIONAL_LAB_ANALYTE_CODES },
      },
      orderBy: [{ measured_at: 'desc' }, { id: 'desc' }],
      take: 6,
      select: {
        analyte_code: true,
        value_numeric: true,
        value_text: true,
        unit: true,
        measured_at: true,
        abnormal_flag: true,
      },
    },
  } as const satisfies Prisma.PatientSelect;
}
