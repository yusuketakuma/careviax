import { buildPatientApiPath } from '@/lib/patient/api-paths';

export function buildSelectedPatientApiUrl(patientId: string): string {
  return buildPatientApiPath(patientId);
}

export function buildActiveCasesForPatientApiUrl(patientId: string): string {
  const params = new URLSearchParams({
    patient_id: patientId,
    status: 'active',
    limit: '20',
  });
  return `/api/cases?${params.toString()}`;
}

export function buildPreviousPrescriptionsApiUrl(patientId: string, caseId: string): string {
  const params = new URLSearchParams({ limit: '5', case_id: caseId });
  return `${buildPatientApiPath(patientId, '/prescriptions')}?${params.toString()}`;
}
