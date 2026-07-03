import type { LabAnalyteCode, Prisma } from '@prisma/client';
import { allocateDisplayIdRange } from '@/lib/db/display-id';
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
  drug_master_id?: string;
  drug_name: string;
  drug_code?: string;
  prescribed_quantity?: number;
  prescribed_daily_dose?: number;
  remaining_quantity: number;
  is_prohibited_reduction: boolean;
};

export function collectResidualMedicationDrugMasterIds(
  residualMedications: VisitRecordResidualMedicationInput[] | undefined,
) {
  const ids = new Set<string>();
  for (const medication of residualMedications ?? []) {
    const id = medication.drug_master_id?.trim();
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

export async function findMissingResidualMedicationDrugMasterIds(
  tx: Prisma.TransactionClient,
  residualMedications: VisitRecordResidualMedicationInput[] | undefined,
) {
  const ids = collectResidualMedicationDrugMasterIds(residualMedications);
  if (ids.length === 0) return [];

  const existing = await tx.drugMaster.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((item) => item.id));
  return ids.filter((id) => !existingIds.has(id));
}

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

  const displayIds = await allocateDisplayIdRange(
    tx,
    'PatientLabObservation',
    orgId,
    entries.length,
  );
  await tx.patientLabObservation.createMany({
    data: entries.map(([key, val], index) => {
      const displayId = displayIds[index];
      if (!displayId) throw new Error('PatientLabObservation display_id allocation range is short');
      return {
        display_id: displayId,
        org_id: orgId,
        patient_id: patientId,
        analyte_code: key as LabAnalyteCode,
        measured_at: visitDate,
        value_numeric: val,
        source_type: 'visit_record',
        source_visit_record_id: visitRecordId,
      };
    }),
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

  const displayIds = await allocateDisplayIdRange(
    tx,
    'ResidualMedication',
    orgId,
    residualMedications.length,
  );
  await Promise.all(
    residualMedications.map((medication, index) => {
      const displayId = displayIds[index];
      if (!displayId) throw new Error('ResidualMedication display_id allocation range is short');
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
          display_id: displayId,
          org_id: orgId,
          visit_record_id: visitRecordId,
          drug_master_id: medication.drug_master_id ?? null,
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
