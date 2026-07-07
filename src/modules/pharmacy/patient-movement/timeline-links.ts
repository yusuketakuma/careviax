import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';

export function buildPharmacyPrescriptionTimelineHref(prescriptionIntakeId: string) {
  return buildPrescriptionHref(prescriptionIntakeId);
}

export function getPharmacyCycleStatusLabel(status: string) {
  return CYCLE_STATUS_LABELS[status] ?? status;
}
