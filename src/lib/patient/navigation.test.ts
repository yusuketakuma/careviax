import { describe, expect, it } from 'vitest';
import { buildPatientHref } from './navigation';

describe('buildPatientHref', () => {
  it('encodes only the patient id path segment and appends suffix unchanged', () => {
    const patientId = 'patient/1?tab=x#frag';

    expect(buildPatientHref(patientId, '/edit?section=team#intake.care_manager.name')).toBe(
      `/patients/${encodeURIComponent(patientId)}/edit?section=team#intake.care_manager.name`,
    );
  });

  it('supports route hash suffixes without encoding them into the patient id', () => {
    const patientId = 'patient 1';

    expect(buildPatientHref(patientId, '#patient-profile-summary')).toBe(
      `/patients/${encodeURIComponent(patientId)}#patient-profile-summary`,
    );
  });

  it('builds the patient detail route without a suffix', () => {
    expect(buildPatientHref('patient_1')).toBe('/patients/patient_1');
  });

  it.each(['.', '..'])('rejects exact dot-segment patient id %s', (patientId) => {
    expect(() => buildPatientHref(patientId)).toThrow(RangeError);
  });
});
