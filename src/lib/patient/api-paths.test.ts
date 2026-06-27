import { describe, expect, it } from 'vitest';
import { buildPatientApiPath } from './api-paths';

describe('buildPatientApiPath', () => {
  it('builds patient detail API paths for normal ids', () => {
    expect(buildPatientApiPath('patient_1')).toBe('/api/patients/patient_1');
  });

  it('encodes only the patient id path segment', () => {
    const patientId = 'patient/1?tab=x#frag';

    expect(buildPatientApiPath(patientId)).toBe(`/api/patients/${encodeURIComponent(patientId)}`);
  });

  it('keeps trusted suffixes outside the encoded patient id segment', () => {
    const patientId = 'patient/1?tab=x#frag';

    expect(buildPatientApiPath(patientId, '/care-team')).toBe(
      `/api/patients/${encodeURIComponent(patientId)}/care-team`,
    );
    expect(buildPatientApiPath(patientId, '/contacts')).toBe(
      `/api/patients/${encodeURIComponent(patientId)}/contacts`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment patient id %s', (patientId) => {
    expect(() => buildPatientApiPath(patientId)).toThrow(RangeError);
  });
});
