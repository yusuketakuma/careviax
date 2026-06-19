import { describe, expect, it } from 'vitest';
import {
  canEditPharmacyOwnedData,
  evaluatePatientShareCaseActivation,
  evaluateVisitBillingCandidate,
  findActivePatientShareConsent,
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
        status: 'pending_partner',
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

  it('requires accepted patient link and both pharmacy approvals before activation', () => {
    expect(
      evaluatePatientShareCaseActivation({
        status: 'pending_partner',
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
        status: 'pending_partner',
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
        status: 'pending_partner',
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

  it('counts only completed requests with confirmed partner visit records as billable', () => {
    expect(
      evaluateVisitBillingCandidate({
        request: { status: 'completed' },
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
