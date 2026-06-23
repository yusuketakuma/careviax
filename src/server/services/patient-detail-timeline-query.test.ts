import { describe, expect, it } from 'vitest';
import {
  buildPatientTimelineConferenceNoteWhere,
  buildPatientTimelineOperationHistoryFilters,
} from './patient-detail-timeline-query';

describe('patient-detail-timeline-query', () => {
  it('keeps patient-level conference notes in scope even when the patient has no cases', () => {
    expect(
      buildPatientTimelineConferenceNoteWhere({
        orgId: 'org_1',
        patientId: 'patient_1',
        caseIds: [],
      }),
    ).toEqual({
      org_id: 'org_1',
      OR: [{ patient_id: 'patient_1', case_id: null }],
    });
  });

  it('includes billing operation history only when billing management is allowed', () => {
    const baseFilters = buildPatientTimelineOperationHistoryFilters({
      patientId: 'patient_1',
      prescriptionIntakeIds: [],
      firstVisitDocumentIds: [],
      billingCandidateIds: ['candidate_1'],
      conferenceNoteIds: [],
      canManageBilling: false,
    });
    const billingFilters = buildPatientTimelineOperationHistoryFilters({
      patientId: 'patient_1',
      prescriptionIntakeIds: [],
      firstVisitDocumentIds: [],
      billingCandidateIds: ['candidate_1'],
      conferenceNoteIds: [],
      canManageBilling: true,
    });

    expect(JSON.stringify(baseFilters)).not.toContain('billing_payment_profile_updated');
    expect(JSON.stringify(baseFilters)).not.toContain('BillingCandidate');
    expect(JSON.stringify(baseFilters)).not.toContain('billing_invoice');
    expect(JSON.stringify(billingFilters)).toContain('billing_payment_profile_updated');
    expect(JSON.stringify(billingFilters)).toContain('BillingCandidate');
    expect(JSON.stringify(billingFilters)).toContain('billing_invoice');
  });

  it('keeps patient/export filters target-scoped so legacy audit rows without patient_id still match', () => {
    const filters = buildPatientTimelineOperationHistoryFilters({
      patientId: 'patient_1',
      prescriptionIntakeIds: [],
      firstVisitDocumentIds: [],
      billingCandidateIds: [],
      conferenceNoteIds: [],
      canManageBilling: true,
    });

    expect(filters[0]).toEqual({
      target_type: 'Patient',
      target_id: 'patient_1',
      action: {
        in: [
          'billing_payment_profile_updated',
          'patient_mcs_profile_updated',
          'patient_mcs_check_log_created',
        ],
      },
    });
    expect(filters[0]).not.toHaveProperty('patient_id');

    expect(filters[1]).toEqual({
      target_type: {
        in: [
          'medication_history',
          'medication_calendar',
          'visit_record_list',
          'prescription_history',
        ],
      },
      target_id: 'patient_1',
      action: 'export',
    });
    expect(filters[1]).not.toHaveProperty('patient_id');
  });
});
