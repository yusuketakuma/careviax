export type PatientShareCaseLifecycleStatus =
  | 'draft'
  | 'consent_pending'
  | 'partner_confirmation_pending'
  | 'active'
  | 'suspended'
  | 'revoked'
  | 'ended'
  | 'declined';

export type PatientLinkLifecycleStatus = 'pending' | 'accepted' | 'declined';

export type PharmacyVisitRequestLifecycleStatus =
  | 'draft'
  | 'requested'
  | 'accepted'
  | 'declined'
  | 'scheduled'
  | 'visited'
  | 'recording'
  | 'submitted'
  | 'base_reviewing'
  | 'returned'
  | 'confirmed'
  | 'physician_report_created'
  | 'claim_checked'
  | 'completed';

export type PartnerVisitRecordLifecycleStatus =
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'returned'
  | 'superseded';

export type PharmacyOwner = 'base_pharmacy' | 'partner_pharmacy';

export type PatientShareConsentForPolicy = {
  consent_date: Date;
  valid_until: Date | null;
  revoked_at: Date | null;
};

export type PatientLinkForPolicy = {
  match_status: PatientLinkLifecycleStatus;
  approved_by_base: string | null;
  approved_by_partner: string | null;
  accepted_at: Date | null;
};

export type PatientShareCaseActivationCheck = {
  status: PatientShareCaseLifecycleStatus;
  consents: readonly PatientShareConsentForPolicy[];
  patientLink: PatientLinkForPolicy | null;
  now: Date;
};

export type PatientShareCaseActivationBlocker =
  | 'invalid_status'
  | 'missing_active_consent'
  | 'patient_link_not_accepted'
  | 'base_approval_missing'
  | 'partner_approval_missing';

export type PatientShareCaseActivationResult =
  | { allowed: true; consent: PatientShareConsentForPolicy }
  | { allowed: false; blocker: PatientShareCaseActivationBlocker };

export type PartnerVisitRecordForBillingPolicy = {
  status: PartnerVisitRecordLifecycleStatus;
  visit_at: Date;
  confirmed_at: Date | null;
};

export type PharmacyVisitRequestForBillingPolicy = {
  status: PharmacyVisitRequestLifecycleStatus;
};

export type PharmacyContractVersionForBillingPolicy = {
  effective_from: Date;
  effective_to: Date | null;
};

export type VisitBillingCandidateBlocker =
  | 'request_not_completed'
  | 'record_not_confirmed'
  | 'visit_outside_month'
  | 'missing_active_consent'
  | 'missing_contract_version'
  | 'contract_not_effective_on_visit';

export type VisitBillingCandidateResult =
  | { billable: true }
  | { billable: false; blockers: VisitBillingCandidateBlocker[] };

const ACTIVATABLE_SHARE_CASE_STATUSES = new Set<PatientShareCaseLifecycleStatus>([
  'partner_confirmation_pending',
  'suspended',
]);

const SUBMITTABLE_RECORD_STATUSES = new Set<PartnerVisitRecordLifecycleStatus>([
  'draft',
  'returned',
]);

function utcDateOnlyTime(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isDateOnOrBefore(left: Date, right: Date) {
  return utcDateOnlyTime(left) <= utcDateOnlyTime(right);
}

function isDateOnOrAfter(left: Date, right: Date) {
  return utcDateOnlyTime(left) >= utcDateOnlyTime(right);
}

export function findActivePatientShareConsent(
  consents: readonly PatientShareConsentForPolicy[],
  now: Date,
) {
  return (
    consents.find((consent) => {
      if (consent.revoked_at) return false;
      if (consent.valid_until && !isDateOnOrAfter(consent.valid_until, now)) return false;
      return isDateOnOrBefore(consent.consent_date, now);
    }) ?? null
  );
}

export function evaluatePatientShareCaseActivation(
  check: PatientShareCaseActivationCheck,
): PatientShareCaseActivationResult {
  if (!ACTIVATABLE_SHARE_CASE_STATUSES.has(check.status)) {
    return { allowed: false, blocker: 'invalid_status' };
  }

  const activeConsent = findActivePatientShareConsent(check.consents, check.now);
  if (!activeConsent) {
    return { allowed: false, blocker: 'missing_active_consent' };
  }

  const patientLink = check.patientLink;
  if (!patientLink || patientLink.match_status !== 'accepted' || !patientLink.accepted_at) {
    return { allowed: false, blocker: 'patient_link_not_accepted' };
  }

  if (!patientLink.approved_by_base) {
    return { allowed: false, blocker: 'base_approval_missing' };
  }

  if (!patientLink.approved_by_partner) {
    return { allowed: false, blocker: 'partner_approval_missing' };
  }

  return { allowed: true, consent: activeConsent };
}

export function canEditPharmacyOwnedData(args: {
  actorOwner: PharmacyOwner;
  targetOwner: PharmacyOwner;
  recordStatus?: PartnerVisitRecordLifecycleStatus;
}) {
  if (args.actorOwner !== args.targetOwner) return false;
  if (!args.recordStatus) return true;
  return SUBMITTABLE_RECORD_STATUSES.has(args.recordStatus);
}

export function shouldNotifyBasePharmacyOnPartnerRecordSubmit(args: {
  previousStatus: PartnerVisitRecordLifecycleStatus;
  nextStatus: PartnerVisitRecordLifecycleStatus;
}) {
  return (
    args.nextStatus === 'submitted' &&
    args.previousStatus !== 'submitted' &&
    args.previousStatus !== 'confirmed'
  );
}

function isDateInBillingMonth(date: Date, billingMonth: Date) {
  return (
    date.getUTCFullYear() === billingMonth.getUTCFullYear() &&
    date.getUTCMonth() === billingMonth.getUTCMonth()
  );
}

function isContractEffectiveOnVisit(
  contractVersion: PharmacyContractVersionForBillingPolicy,
  visitAt: Date,
) {
  if (!isDateOnOrAfter(visitAt, contractVersion.effective_from)) return false;
  if (contractVersion.effective_to && !isDateOnOrBefore(visitAt, contractVersion.effective_to)) {
    return false;
  }
  return true;
}

export function evaluateVisitBillingCandidate(args: {
  request: PharmacyVisitRequestForBillingPolicy;
  record: PartnerVisitRecordForBillingPolicy;
  activeConsent: PatientShareConsentForPolicy | null;
  contractVersion: PharmacyContractVersionForBillingPolicy | null;
  billingMonth: Date;
}): VisitBillingCandidateResult {
  const blockers: VisitBillingCandidateBlocker[] = [];

  if (
    args.request.status !== 'confirmed' &&
    args.request.status !== 'physician_report_created' &&
    args.request.status !== 'claim_checked' &&
    args.request.status !== 'completed'
  ) {
    blockers.push('request_not_completed');
  }
  if (args.record.status !== 'confirmed' || !args.record.confirmed_at) {
    blockers.push('record_not_confirmed');
  }
  if (!isDateInBillingMonth(args.record.visit_at, args.billingMonth)) {
    blockers.push('visit_outside_month');
  }
  if (!args.activeConsent) blockers.push('missing_active_consent');
  if (!args.contractVersion) {
    blockers.push('missing_contract_version');
  } else if (!isContractEffectiveOnVisit(args.contractVersion, args.record.visit_at)) {
    blockers.push('contract_not_effective_on_visit');
  }

  if (blockers.length > 0) return { billable: false, blockers };
  return { billable: true };
}
