import type { LabAnalyteCode, Prisma } from '@prisma/client';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';

const LAB_ANALYTE_CODES = new Set([
  'wbc',
  'neut',
  'hb',
  'plt',
  'pt_inr',
  'ast',
  'alt',
  't_bil',
  'scr',
  'egfr',
  'bun',
  'ck',
  'bnp',
  'nt_pro_bnp',
  'na',
  'k',
  'cl',
  'hba1c',
  'blood_glucose',
  'alb',
  'tp',
  'crp',
]);

export type VisitRecordResidualMedicationInput = {
  drug_name: string;
  drug_code?: string;
  prescribed_quantity?: number;
  prescribed_daily_dose?: number;
  remaining_quantity: number;
  is_prohibited_reduction: boolean;
};

export async function syncVisitRecordLabObservations(
  tx: Prisma.TransactionClient,
  orgId: string,
  patientId: string,
  visitRecordId: string,
  visitDate: Date,
  structuredSoap: unknown,
) {
  const structuredSoapObject = readJsonObject(normalizeJsonInput(structuredSoap));
  const objective = readJsonObject(structuredSoapObject?.objective);
  const labValues = readJsonObject(objective?.lab_values);
  const entries = Object.entries(labValues ?? {}).filter(
    ([key, val]) => LAB_ANALYTE_CODES.has(key) && typeof val === 'number',
  ) as [string, number][];

  await tx.patientLabObservation.deleteMany({
    where: { org_id: orgId, source_visit_record_id: visitRecordId },
  });

  if (entries.length === 0) return;

  await tx.patientLabObservation.createMany({
    data: entries.map(([key, val]) => ({
      org_id: orgId,
      patient_id: patientId,
      analyte_code: key as LabAnalyteCode,
      measured_at: visitDate,
      value_numeric: val,
      source_type: 'visit_record',
      source_visit_record_id: visitRecordId,
    })),
  });
}

export async function replaceVisitRecordResidualMedications(
  tx: Prisma.TransactionClient,
  orgId: string,
  visitRecordId: string,
  residualMedications: VisitRecordResidualMedicationInput[] | undefined,
) {
  await tx.residualMedication.deleteMany({
    where: {
      org_id: orgId,
      visit_record_id: visitRecordId,
    },
  });

  if (!residualMedications || residualMedications.length === 0) return;

  await Promise.all(
    residualMedications.map((medication) => {
      let excessDays: number | undefined;
      if (
        medication.prescribed_daily_dose &&
        medication.prescribed_daily_dose > 0 &&
        medication.remaining_quantity > 0
      ) {
        excessDays = Math.floor(medication.remaining_quantity / medication.prescribed_daily_dose);
      }

      return tx.residualMedication.create({
        data: {
          org_id: orgId,
          visit_record_id: visitRecordId,
          drug_name: medication.drug_name,
          drug_code: medication.drug_code,
          prescribed_quantity: medication.prescribed_quantity,
          remaining_quantity: medication.remaining_quantity,
          excess_days: excessDays ?? null,
          is_reduction_target: excessDays !== undefined && excessDays > 7,
          is_prohibited_reduction: medication.is_prohibited_reduction,
        },
      });
    }),
  );
}
