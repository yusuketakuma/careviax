import { encodePathSegment } from '@/lib/http/path-segment';

export const PATIENTS_API_PATH = '/api/patients';
export const PATIENT_DUPLICATE_CHECK_API_PATH = `${PATIENTS_API_PATH}/check-duplicate`;

export function buildPatientDuplicateCheckApiPath(params: URLSearchParams) {
  const query = params.toString();
  return query ? `${PATIENT_DUPLICATE_CHECK_API_PATH}?${query}` : PATIENT_DUPLICATE_CHECK_API_PATH;
}

export function buildPatientApiPath(patientId: string, suffix = '') {
  return `${PATIENTS_API_PATH}/${encodePathSegment(patientId)}${suffix}`;
}

export function buildPatientWorkflowPreviewApiPath(patientId: string) {
  return buildPatientApiPath(patientId, '/workflow-preview');
}

export function buildPatientMedicationStockApiPath(patientId: string) {
  return buildPatientApiPath(patientId, '/medication-stock');
}
