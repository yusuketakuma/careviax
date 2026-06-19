import { describe, expect, it } from 'vitest';
import {
  canEditPharmacyOwnedData,
  evaluatePatientShareCaseActivation,
  evaluateVisitBillingCandidate,
  findActivePatientShareConsent,
  resolvePatientShareCaseTransition,
  resolvePharmacyContractCreationStatus,
  resolvePharmacyContractVersionCreationStatus,
  resolvePartnerVisitRecordTransition,
  resolvePharmacyVisitRequestTransition,
  shouldNotifyBasePharmacyOnPartnerRecordSubmit,
  type PatientShareConsentForPolicy,
} from './pharmacy-partnerships';

const NOW = new Date('2026-06-19T00:00:00.000Z');
const ACTIVE_CONSENT: PatientShareConsentForPolicy = {
  consent_date: new Date('2026-06-01T00:00:00.000Z'),
  valid_until: new Date('2026-12-31T00:00:00.000Z'),
  revoked_at: null,
};

describe('pharmacy partnership policy guards', () => {
  it('selects only current unrevoked patient-share consent', () => {
    expect(
      findActivePatientShareConsent(
        [
          {
            consent_date: new Date('2026-05-01T00:00:00.000Z'),
            valid_until: null,
            revoked_at: new Date('2026-06-01T00:00:00.000Z'),
          },
          {
            consent_date: new Date('2026-05-01T00:00:00.000Z'),
            valid_until: new Date('2026-06-18T00:00:00.000Z'),
            revoked_at: null,
          },
          ACTIVE_CONSENT,
        ],
        NOW,
      ),
    ).toBe(ACTIVE_CONSENT);
  });

  it('treats date-only consent and contract end dates as valid through the whole day', () => {
    const noon = new Date('2026-06-19T12:00:00.000Z');
    const consent = {
      consent_date: new Date('2026-06-19T00:00:00.000Z'),
      valid_until: new Date('2026-06-19T00:00:00.000Z'),
      revoked_at: null,
    };

    expect(findActivePatientShareConsent([consent], noon)).toBe(consent);
    expect(
      evaluateVisitBillingCandidate({
        request: { status: 'completed' },
        record: {
          status: 'confirmed',
          confirmed_at: noon,
          visit_at: noon,
        },
        activeConsent: consent,
        contractVersion: {
          effective_from: new Date('2026-06-01T00:00:00.000Z'),
          effective_to: new Date('2026-06-19T00:00:00.000Z'),
        },
        billingMonth: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toEqual({ billable: true });
  });

  it('blocks activating a patient share case without active consent', () => {
    expect(
      evaluatePatientShareCaseActivation({
        status: 'partner_confirmation_pending',
        consents: [],
        now: NOW,
        patientLink: {
          match_status: 'accepted',
          accepted_at: NOW,
          approved_by_base: 'base-user',
          approved_by_partner: 'partner-user',
        },
      }),
    ).toEqual({ allowed: false, blocker: 'missing_active_consent' });
  });

  it('blocks activation while the case is still waiting for patient consent', () => {
    expect(
      evaluatePatientShareCaseActivation({
        status: 'consent_pending',
        consents: [ACTIVE_CONSENT],
        now: NOW,
        patientLink: {
          match_status: 'accepted',
          accepted_at: NOW,
          approved_by_base: 'base-user',
          approved_by_partner: 'partner-user',
        },
      }),
    ).toEqual({ allowed: false, blocker: 'invalid_status' });
  });

  it('requires accepted patient link and both pharmacy approvals before activation', () => {
    expect(
      evaluatePatientShareCaseActivation({
        status: 'partner_confirmation_pending',
        consents: [ACTIVE_CONSENT],
        now: NOW,
        patientLink: {
          match_status: 'pending',
          accepted_at: null,
          approved_by_base: 'base-user',
          approved_by_partner: 'partner-user',
        },
      }),
    ).toEqual({ allowed: false, blocker: 'patient_link_not_accepted' });

    expect(
      evaluatePatientShareCaseActivation({
        status: 'partner_confirmation_pending',
        consents: [ACTIVE_CONSENT],
        now: NOW,
        patientLink: {
          match_status: 'accepted',
          accepted_at: NOW,
          approved_by_base: null,
          approved_by_partner: 'partner-user',
        },
      }),
    ).toEqual({ allowed: false, blocker: 'base_approval_missing' });
  });

  it('allows activation when consent, patient link, and both approvals are present', () => {
    expect(
      evaluatePatientShareCaseActivation({
        status: 'partner_confirmation_pending',
        consents: [ACTIVE_CONSENT],
        now: NOW,
        patientLink: {
          match_status: 'accepted',
          accepted_at: NOW,
          approved_by_base: 'base-user',
          approved_by_partner: 'partner-user',
        },
      }),
    ).toEqual({ allowed: true, consent: ACTIVE_CONSENT });
  });

  it('denies direct edits to data owned by the other pharmacy and locks submitted records', () => {
    expect(
      canEditPharmacyOwnedData({
        actorOwner: 'partner_pharmacy',
        targetOwner: 'base_pharmacy',
      }),
    ).toBe(false);

    expect(
      canEditPharmacyOwnedData({
        actorOwner: 'partner_pharmacy',
        targetOwner: 'partner_pharmacy',
        recordStatus: 'submitted',
      }),
    ).toBe(false);

    expect(
      canEditPharmacyOwnedData({
        actorOwner: 'partner_pharmacy',
        targetOwner: 'partner_pharmacy',
        recordStatus: 'returned',
      }),
    ).toBe(true);
  });

  it('notifies the base pharmacy only when a partner visit record newly enters submitted', () => {
    expect(
      shouldNotifyBasePharmacyOnPartnerRecordSubmit({
        previousStatus: 'draft',
        nextStatus: 'submitted',
      }),
    ).toBe(true);

    expect(
      shouldNotifyBasePharmacyOnPartnerRecordSubmit({
        previousStatus: 'submitted',
        nextStatus: 'submitted',
      }),
    ).toBe(false);

    expect(
      shouldNotifyBasePharmacyOnPartnerRecordSubmit({
        previousStatus: 'submitted',
        nextStatus: 'confirmed',
      }),
    ).toBe(false);
  });

  it('resolves visit request transitions through explicit lifecycle rules', () => {
    expect(
      resolvePharmacyVisitRequestTransition({
        currentStatus: 'requested',
        action: 'accept',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'accepted',
      allowedFrom: ['requested'],
    });

    expect(
      resolvePharmacyVisitRequestTransition({
        currentStatus: 'accepted',
        action: 'accept',
      }),
    ).toMatchObject({
      allowed: false,
      nextStatus: 'accepted',
      allowedFrom: ['requested'],
    });

    expect(
      resolvePharmacyVisitRequestTransition({
        currentStatus: 'returned',
        action: 'submit_partner_record',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'submitted',
      allowedFrom: ['accepted', 'recording', 'returned'],
    });

    expect(
      resolvePharmacyVisitRequestTransition({
        currentStatus: 'submitted',
        action: 'confirm_partner_record',
      }),
    ).toMatchObject({ allowed: true, nextStatus: 'confirmed' });

    expect(
      resolvePharmacyVisitRequestTransition({
        currentStatus: 'submitted',
        action: 'return_partner_record',
      }),
    ).toMatchObject({ allowed: true, nextStatus: 'returned' });

    expect(
      resolvePharmacyVisitRequestTransition({
        currentStatus: 'confirmed',
        action: 'create_physician_report',
      }),
    ).toMatchObject({ allowed: true, nextStatus: 'physician_report_created' });

    expect(
      resolvePharmacyVisitRequestTransition({
        currentStatus: 'physician_report_created',
        action: 'mark_claim_checked',
      }),
    ).toMatchObject({ allowed: true, nextStatus: 'claim_checked' });

    expect(
      resolvePharmacyVisitRequestTransition({
        currentStatus: 'submitted',
        action: 'mark_claim_checked',
      }),
    ).toMatchObject({
      allowed: false,
      nextStatus: 'claim_checked',
      allowedFrom: ['confirmed', 'physician_report_created'],
    });
  });

  it('resolves patient share case transitions through explicit lifecycle rules', () => {
    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'consent_pending',
        action: 'register_consent',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'partner_confirmation_pending',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'active',
        action: 'register_consent',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'active',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'draft',
        action: 'approve_patient_link',
        hasActiveConsent: false,
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'consent_pending',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'draft',
        action: 'accept_patient_link',
        hasActiveConsent: true,
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'partner_confirmation_pending',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'partner_confirmation_pending',
        action: 'decline_patient_link',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'declined',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'active',
        action: 'decline_patient_link',
      }),
    ).toMatchObject({
      allowed: false,
      nextStatus: 'active',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'active',
        action: 'revoke_consent',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'revoked',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'partner_confirmation_pending',
        action: 'activate',
        hasActiveConsent: false,
        patientLinkAccepted: true,
        hasBaseApproval: true,
        hasPartnerApproval: true,
      }),
    ).toMatchObject({
      allowed: false,
      nextStatus: 'partner_confirmation_pending',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'partner_confirmation_pending',
        action: 'activate',
        hasActiveConsent: true,
        patientLinkAccepted: false,
        hasBaseApproval: true,
        hasPartnerApproval: true,
      }),
    ).toMatchObject({
      allowed: false,
      nextStatus: 'partner_confirmation_pending',
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'suspended',
        action: 'activate',
        hasActiveConsent: true,
        patientLinkAccepted: true,
        hasBaseApproval: true,
        hasPartnerApproval: true,
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'active',
      allowedFrom: ['partner_confirmation_pending', 'suspended'],
    });

    expect(
      resolvePatientShareCaseTransition({
        currentStatus: 'revoked',
        action: 'register_consent',
      }),
    ).toMatchObject({
      allowed: false,
      nextStatus: 'revoked',
    });
  });

  it('resolves partner visit record transitions through explicit lifecycle rules', () => {
    expect(
      resolvePartnerVisitRecordTransition({
        currentStatus: 'draft',
        action: 'submit',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'submitted',
      allowedFrom: ['draft', 'returned'],
    });

    expect(
      resolvePartnerVisitRecordTransition({
        currentStatus: 'returned',
        action: 'submit',
      }),
    ).toMatchObject({ allowed: true, nextStatus: 'submitted' });

    expect(
      resolvePartnerVisitRecordTransition({
        currentStatus: 'submitted',
        action: 'confirm',
      }),
    ).toMatchObject({ allowed: true, nextStatus: 'confirmed' });

    expect(
      resolvePartnerVisitRecordTransition({
        currentStatus: 'submitted',
        action: 'return',
      }),
    ).toMatchObject({ allowed: true, nextStatus: 'returned' });

    expect(
      resolvePartnerVisitRecordTransition({
        currentStatus: 'confirmed',
        action: 'return',
      }),
    ).toMatchObject({
      allowed: false,
      nextStatus: 'returned',
      allowedFrom: ['submitted'],
    });
  });

  it('resolves pharmacy contract creation status through explicit lifecycle policy', () => {
    expect(
      resolvePharmacyContractCreationStatus({
        requestedStatus: 'draft',
        partnershipStatus: 'suspended',
        partnerPharmacyStatus: 'archived',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'draft',
    });

    expect(
      resolvePharmacyContractCreationStatus({
        requestedStatus: 'active',
        hasBaseApproval: true,
        hasPartnerApproval: true,
        partnershipStatus: 'suspended',
        partnerPharmacyStatus: 'active',
      }),
    ).toMatchObject({
      allowed: false,
      blocker: 'partnership_not_active',
    });

    expect(
      resolvePharmacyContractCreationStatus({
        requestedStatus: 'active',
        hasBaseApproval: true,
        hasPartnerApproval: false,
        partnershipStatus: 'active',
        partnerPharmacyStatus: 'active',
      }),
    ).toMatchObject({
      allowed: false,
      blocker: 'missing_partner_approval',
    });

    expect(
      resolvePharmacyContractCreationStatus({
        requestedStatus: 'active',
        hasBaseApproval: true,
        hasPartnerApproval: true,
        partnershipStatus: 'active',
        partnerPharmacyStatus: 'active',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'active',
    });
  });

  it('resolves pharmacy contract version creation status through explicit lifecycle policy', () => {
    expect(
      resolvePharmacyContractVersionCreationStatus({
        requestedStatus: 'draft',
        contractStatus: 'terminated',
        partnershipStatus: 'active',
        partnerPharmacyStatus: 'active',
      }),
    ).toMatchObject({
      allowed: false,
      blocker: 'terminal_contract',
    });

    expect(
      resolvePharmacyContractVersionCreationStatus({
        requestedStatus: 'draft',
        contractStatus: 'suspended',
        partnershipStatus: 'active',
        partnerPharmacyStatus: 'active',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'draft',
    });

    expect(
      resolvePharmacyContractVersionCreationStatus({
        requestedStatus: 'active',
        contractStatus: 'suspended',
        hasBaseApproval: true,
        hasPartnerApproval: true,
        partnershipStatus: 'active',
        partnerPharmacyStatus: 'active',
      }),
    ).toMatchObject({
      allowed: false,
      blocker: 'contract_not_active',
    });

    expect(
      resolvePharmacyContractVersionCreationStatus({
        requestedStatus: 'active',
        contractStatus: 'active',
        hasBaseApproval: true,
        hasPartnerApproval: true,
        partnershipStatus: 'active',
        partnerPharmacyStatus: 'inactive',
      }),
    ).toMatchObject({
      allowed: false,
      blocker: 'partner_pharmacy_not_active',
    });

    expect(
      resolvePharmacyContractVersionCreationStatus({
        requestedStatus: 'active',
        contractStatus: 'active',
        hasBaseApproval: true,
        hasPartnerApproval: true,
        partnershipStatus: 'active',
        partnerPharmacyStatus: 'active',
      }),
    ).toMatchObject({
      allowed: true,
      nextStatus: 'active',
    });
  });

  it('counts only confirmed-or-later requests with confirmed partner visit records as billable', () => {
    expect(
      evaluateVisitBillingCandidate({
        request: { status: 'confirmed' },
        record: {
          status: 'confirmed',
          confirmed_at: new Date('2026-06-19T03:00:00.000Z'),
          visit_at: new Date('2026-06-19T02:00:00.000Z'),
        },
        activeConsent: ACTIVE_CONSENT,
        contractVersion: {
          effective_from: new Date('2026-06-01T00:00:00.000Z'),
          effective_to: new Date('2026-06-30T23:59:59.000Z'),
        },
        billingMonth: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toEqual({ billable: true });

    expect(
      evaluateVisitBillingCandidate({
        request: { status: 'accepted' },
        record: {
          status: 'submitted',
          confirmed_at: null,
          visit_at: new Date('2026-06-19T02:00:00.000Z'),
        },
        activeConsent: null,
        contractVersion: {
          effective_from: new Date('2026-07-01T00:00:00.000Z'),
          effective_to: null,
        },
        billingMonth: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toEqual({
      billable: false,
      blockers: [
        'request_not_completed',
        'record_not_confirmed',
        'missing_active_consent',
        'contract_not_effective_on_visit',
      ],
    });
  });
});
