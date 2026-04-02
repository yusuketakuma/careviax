import { describe, expect, it } from 'vitest';
import { patientMcsLinkSchema, syncPatientMcsSchema } from './patient-mcs';

describe('patient-mcs validation', () => {
  it('accepts supported patient and project URLs', () => {
    expect(
      patientMcsLinkSchema.safeParse({
        source_url: 'https://www.medical-care.net/patients/2463520',
      }).success
    ).toBe(true);

    expect(
      syncPatientMcsSchema.safeParse({
        source_url: 'https://www.medical-care.net/projects/unavailable/57886227/patient',
      }).success
    ).toBe(true);
  });

  it('rejects unsupported hosts and MCS paths', () => {
    expect(
      patientMcsLinkSchema.safeParse({
        source_url: 'https://www.evilmedical-care.net/patients/2463520',
      }).success
    ).toBe(false);

    expect(
      syncPatientMcsSchema.safeParse({
        source_url: 'https://www.medical-care.net/home',
      }).success
    ).toBe(false);
  });
});
