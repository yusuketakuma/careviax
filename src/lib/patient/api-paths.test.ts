import { describe, expect, it } from 'vitest';
import {
  PATIENTS_API_PATH,
  PATIENT_DUPLICATE_CHECK_API_PATH,
  buildPatientApiPath,
  buildPatientDuplicateCheckApiPath,
  buildPatientMedicationStockApiPath,
  buildPatientWorkflowPreviewApiPath,
} from './api-paths';

describe('patient collection API paths', () => {
  it('exposes the patient collection path', () => {
    expect(PATIENTS_API_PATH).toBe('/api/patients');
  });
});

describe('buildPatientDuplicateCheckApiPath', () => {
  it('builds the duplicate-check path with encoded query parameters', () => {
    const params = new URLSearchParams({
      name: '山田 太郎',
      date_of_birth: '1950-01-01',
      gender: 'male',
    });

    expect(PATIENT_DUPLICATE_CHECK_API_PATH).toBe('/api/patients/check-duplicate');
    expect(buildPatientDuplicateCheckApiPath(params)).toBe(
      '/api/patients/check-duplicate?name=%E5%B1%B1%E7%94%B0+%E5%A4%AA%E9%83%8E&date_of_birth=1950-01-01&gender=male',
    );
  });

  it('omits the trailing question mark when no query parameters are present', () => {
    expect(buildPatientDuplicateCheckApiPath(new URLSearchParams())).toBe(
      '/api/patients/check-duplicate',
    );
  });
});

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
      '/conditions',
      '/contacts',
      '/communications',
      '/documents',
      '/labs',
      '/packaging',
      '/prescriptions',
      '/readiness',
      '/mcs',
      '/mcs-sync',
      '/medication-stock',
      '/mcs/logs',
      '/medications/pdf',
      '/overview',
      '/timeline',
      '/visit-constraints',
      '/visits',
      '/visit-brief',
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

describe('buildPatientMedicationStockApiPath', () => {
  it('builds the medication stock API path from the shared patient path helper', () => {
    expect(buildPatientMedicationStockApiPath('patient_1')).toBe(
      '/api/patients/patient_1/medication-stock',
    );
  });

  it('encodes only the patient id path segment', () => {
    const patientId = 'patient/1?tab=x#frag';

    expect(buildPatientMedicationStockApiPath(patientId)).toBe(
      `/api/patients/${encodeURIComponent(patientId)}/medication-stock`,
    );
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
