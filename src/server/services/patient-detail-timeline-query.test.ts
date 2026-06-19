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
});
