export function buildPrescriptionHref(prescriptionIntakeId: string) {
  if (prescriptionIntakeId === '.' || prescriptionIntakeId === '..') {
    throw new RangeError('Prescription intake id cannot be a dot segment');
  }

  return `/prescriptions/${encodeURIComponent(prescriptionIntakeId)}`;
}
