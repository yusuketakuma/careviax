import {
  buildPatientArchiveSummary,
  type PatientArchiveSummary,
} from '@/lib/patient/archive-summary';

export const PDF_PATIENT_SUMMARY_SELECT = {
  id: true,
  name: true,
  birth_date: true,
  gender: true,
  archived_at: true,
} as const;

export type PdfPatientSummary = {
  id: string;
  name: string;
  birth_date: Date;
  gender: string;
  archive: PatientArchiveSummary;
};

type PdfPatientSummarySource = {
  id: string;
  name: string;
  birth_date: Date;
  gender: string;
  archived_at?: Date | string | null;
};

export function buildPdfPatientSummary(patient: PdfPatientSummarySource): PdfPatientSummary {
  return {
    id: patient.id,
    name: patient.name,
    birth_date: patient.birth_date,
    gender: patient.gender,
    archive: buildPatientArchiveSummary(patient.archived_at),
  };
}
