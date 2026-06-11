import { prisma } from '@/lib/db/client';
import {
  applyPatientAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { PdfNotFoundError } from './pdf-errors';

export type MedicationProfileRow = {
  id: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  start_date: Date | null;
  end_date: Date | null;
  prescriber: string | null;
  source: string | null;
};

export type MedicationHistoryRecord = {
  patient: {
    id: string;
    name: string;
    birth_date: Date;
    gender: string;
  };
  medications: MedicationProfileRow[];
};

export async function getMedicationHistoryRecord(
  orgId: string,
  patientId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<MedicationHistoryRecord> {
  const patient = await prisma.patient.findFirst({
    where: accessContext
      ? applyPatientAssignmentWhere({ id: patientId, org_id: orgId }, accessContext)
      : { id: patientId, org_id: orgId },
    select: {
      id: true,
      name: true,
      birth_date: true,
      gender: true,
    },
  });

  if (!patient) {
    throw new PdfNotFoundError('patient');
  }

  const medications = await prisma.medicationProfile.findMany({
    where: { org_id: orgId, patient_id: patientId, is_current: true },
    orderBy: [{ drug_name: 'asc' }, { created_at: 'desc' }],
    select: {
      id: true,
      drug_name: true,
      dose: true,
      frequency: true,
      start_date: true,
      end_date: true,
      prescriber: true,
      source: true,
    },
  });

  return {
    patient,
    medications,
  };
}
