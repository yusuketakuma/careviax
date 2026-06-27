import { describe, expect, it } from 'vitest';
import { buildPatientApiPath, buildPatientWorkflowPreviewApiPath } from './api-paths';

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

    for (const suffix of [
      '/care-team',
      '/contacts',
      '/communications',
      '/documents',
      '/labs',
      '/prescriptions',
      '/readiness',
      '/mcs',
      '/mcs-sync',
      '/mcs/logs',
      '/visits',
      '/visit-records/pdf',
    ]) {
      expect(buildPatientApiPath(patientId, suffix)).toBe(
        `/api/patients/${encodeURIComponent(patientId)}${suffix}`,
      );
    }
  });

  it.each(['.', '..'])('rejects exact dot-segment patient id %s', (patientId) => {
    expect(() => buildPatientApiPath(patientId)).toThrow(RangeError);
  });
});

describe('buildPatientWorkflowPreviewApiPath', () => {
  it('builds the workflow preview API path from the shared patient path helper', () => {
    expect(buildPatientWorkflowPreviewApiPath('patient_1')).toBe(
      '/api/patients/patient_1/workflow-preview',
    );
  });

  it('encodes only the patient id path segment', () => {
    const patientId = 'patient/1?tab=x#frag';

    expect(buildPatientWorkflowPreviewApiPath(patientId)).toBe(
      `/api/patients/${encodeURIComponent(patientId)}/workflow-preview`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment patient id %s', (patientId) => {
    expect(() => buildPatientWorkflowPreviewApiPath(patientId)).toThrow(RangeError);
  });
});
