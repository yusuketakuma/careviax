import { encodePathSegment } from '@/lib/http/path-segment';

export function buildPatientApiPath(patientId: string, suffix = '') {
  return `/api/patients/${encodePathSegment(patientId)}${suffix}`;
}
