export function buildPatientHref(patientId: string, suffix = '') {
  if (patientId === '.' || patientId === '..') {
    throw new RangeError('Patient id cannot be a dot segment');
  }

  return `/patients/${encodeURIComponent(patientId)}${suffix}`;
}
