import { describe, expect, it, vi } from 'vitest';
import {
  emptyPatientShareSummary,
  listActivePatientShareSummaries,
} from '@/server/services/patient-share-summary';

describe('patient share summary', () => {
  it('derives patient share state from active patient share cases', async () => {
    const patientShareCaseFindManyMock = vi.fn().mockResolvedValue([
      {
        base_patient_id: 'patient_1',
        share_scope: {
          prescription_history: true,
          medication_profile: true,
          care_reports: false,
          attachments: false,
          print: false,
          pdf_output: true,
          download: false,
        },
        partnership: { partner_pharmacy_id: 'partner_pharmacy_1' },
      },
      {
        base_patient_id: 'patient_1',
        share_scope: {
          prescription_history: false,
          medication_profile: false,
          care_reports: true,
          attachments: true,
          print: false,
          pdf_output: false,
          download: false,
        },
        partnership: { partner_pharmacy_id: 'partner_pharmacy_2' },
      },
    ]);

    const summaries = await listActivePatientShareSummaries(
      {
        patientShareCase: { findMany: patientShareCaseFindManyMock },
      },
      {
        orgId: 'org_1',
        patientIds: ['patient_1', 'patient_2'],
        asOf: new Date('2026-06-19T12:00:00.000Z'),
      },
    );

    expect(patientShareCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: 'active',
          base_patient_id: { in: ['patient_1', 'patient_2'] },
        }),
      }),
    );
    expect(summaries.get('patient_1')).toEqual({
      status: 'active',
      active_case_count: 2,
      partner_pharmacy_count: 2,
      scope_keys: [
        'attachments',
        'care_reports',
        'medication_profile',
        'pdf_output',
        'prescription_history',
      ],
    });
    expect(summaries.get('patient_2')).toEqual(emptyPatientShareSummary());
  });
});
