import { describe, expect, it } from 'vitest';
import {
  buildActiveCasesForPatientApiUrl,
  buildPreviousPrescriptionsApiUrl,
  buildSelectedPatientApiUrl,
} from './prescription-intake-urls';

describe('prescription intake URL builders', () => {
  it('encodes selected patient detail and previous prescription patient path segments', () => {
    const patientId = 'pt/1?tab=x#frag&case_id=evil';
    const caseId = 'case/1?x=y#z&patient_id=evil';

    expect(buildSelectedPatientApiUrl(patientId)).toBe(
      `/api/patients/${encodeURIComponent(patientId)}`,
    );
    expect(buildPreviousPrescriptionsApiUrl(patientId, caseId)).toBe(
      `/api/patients/${encodeURIComponent(patientId)}/prescriptions?limit=5&case_id=${encodeURIComponent(caseId)}`,
    );
  });

  it('encodes selected patient ids inside active case query values', () => {
    const patientId = 'pt/1?tab=x#frag&status=closed&limit=999';

    expect(buildActiveCasesForPatientApiUrl(patientId)).toBe(
      `/api/cases?patient_id=${encodeURIComponent(patientId)}&status=active&limit=20`,
    );
    expect(buildActiveCasesForPatientApiUrl(patientId)).not.toContain('&status=closed');
    expect(buildActiveCasesForPatientApiUrl(patientId)).not.toContain('&limit=999');
  });

  it.each(['.', '..'])('fails closed for exact dot-segment patient ids (%s)', (patientId) => {
    expect(() => buildSelectedPatientApiUrl(patientId)).toThrow(RangeError);
    expect(() => buildPreviousPrescriptionsApiUrl(patientId, 'case_1')).toThrow(RangeError);
  });
});
