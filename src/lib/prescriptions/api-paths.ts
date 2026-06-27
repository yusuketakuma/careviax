import { encodePathSegment } from '@/lib/http/path-segment';

export function buildPrescriptionIntakeApiPath(intakeId: string) {
  return `/api/prescription-intakes/${encodePathSegment(intakeId)}`;
}
