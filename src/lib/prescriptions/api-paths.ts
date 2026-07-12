import { encodePathSegment } from '@/lib/http/path-segment';

export function buildPrescriptionIntakeApiPath(intakeId: string) {
  return `/api/prescription-intakes/${encodePathSegment(intakeId)}`;
}

export function buildMedicationCycleHistoryApiPath(cycleId: string) {
  return `/api/medication-cycles/${encodePathSegment(cycleId)}/history`;
}
