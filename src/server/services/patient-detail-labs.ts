import type { LabAnalyteCode, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { KEY_LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';
import type { PatientDetailScopeArgs } from '@/server/services/patient-detail-scope';

export type PatientLabSummaryDb = Pick<
  typeof prisma | Prisma.TransactionClient,
  'patientLabObservation'
>;

type PatientLabSummaryArgs = Pick<PatientDetailScopeArgs, 'orgId' | 'patientId'>;

export type LatestPatientLabObservation = {
  id: string;
  analyte_code: LabAnalyteCode;
  measured_at: Date;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  abnormal_flag: string | null;
};

function firstLabPerAnalyte<T extends { analyte_code: string }>(labRows: T[]): T[] {
  const labSummaryMap = new Map<string, T>();
  for (const row of labRows) {
    if (!labSummaryMap.has(row.analyte_code)) {
      labSummaryMap.set(row.analyte_code, row);
    }
  }

  return Array.from(labSummaryMap.values());
}

export async function listPatientLabSummary(db: PatientLabSummaryDb, args: PatientLabSummaryArgs) {
  const labRows = await db.patientLabObservation.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      analyte_code: { in: [...KEY_LAB_ANALYTE_CODES] },
    },
    orderBy: [{ measured_at: 'desc' }],
    take: 50,
    select: {
      analyte_code: true,
      measured_at: true,
      value_numeric: true,
      unit: true,
      abnormal_flag: true,
    },
  });

  return firstLabPerAnalyte(labRows);
}

export async function listLatestPatientLabObservations(
  db: PatientLabSummaryDb,
  args: PatientLabSummaryArgs,
): Promise<LatestPatientLabObservation[]> {
  const labRows = await db.patientLabObservation.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      analyte_code: { in: [...KEY_LAB_ANALYTE_CODES] },
    },
    orderBy: [{ measured_at: 'desc' }, { created_at: 'desc' }],
    take: 50,
    select: {
      id: true,
      analyte_code: true,
      measured_at: true,
      value_numeric: true,
      value_text: true,
      unit: true,
      abnormal_flag: true,
    },
  });

  return firstLabPerAnalyte(labRows);
}
