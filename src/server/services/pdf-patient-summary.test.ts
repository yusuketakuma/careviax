import { describe, expect, it } from 'vitest';
import { buildPdfPatientSummary } from './pdf-patient-summary';

describe('buildPdfPatientSummary', () => {
  it('adds minimal archive state without exposing archive ownership fields', () => {
    const patient = {
      id: 'patient_1',
      name: '山田 太郎',
      birth_date: new Date('1940-01-01T00:00:00.000Z'),
      gender: 'male',
      archived_at: new Date('2026-06-30T09:00:00.000Z'),
      archived_by: 'internal_user',
    };

    const summary = buildPdfPatientSummary(patient);

    expect(summary).toMatchObject({
      id: 'patient_1',
      name: '山田 太郎',
      archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-06-30T09:00:00.000Z',
      },
    });
    expect(JSON.stringify(summary)).not.toContain('archived_by');
    expect(JSON.stringify(summary)).not.toContain('internal_user');
  });
});
