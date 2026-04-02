import { z } from 'zod';
import {
  parseMedicalCareStationUrl,
  PATIENT_MCS_SOURCE_URL_MESSAGE,
} from '@/lib/patient-mcs/source';

const medicalCareStationUrlSchema = z
  .string()
  .trim()
  .url(PATIENT_MCS_SOURCE_URL_MESSAGE)
  .refine((value) => parseMedicalCareStationUrl(value) !== null, PATIENT_MCS_SOURCE_URL_MESSAGE);

export const patientMcsLinkSchema = z.object({
  source_url: medicalCareStationUrlSchema,
});

export const syncPatientMcsSchema = z.object({
  source_url: medicalCareStationUrlSchema.optional(),
});

export type PatientMcsLinkInput = z.infer<typeof patientMcsLinkSchema>;
export type SyncPatientMcsInput = z.infer<typeof syncPatientMcsSchema>;
