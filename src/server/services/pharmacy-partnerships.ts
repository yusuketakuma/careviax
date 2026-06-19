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

export type PatientShareCaseTransitionAction =
  | 'register_consent'
  | 'approve_patient_link'
  | 'accept_patient_link'
  | 'decline_patient_link'
  | 'revoke_consent'
  | 'activate';

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

export type StatusTransitionResult<Status extends string> =
  | {
      allowed: true;
      currentStatus: Status;
      nextStatus: Status;
      allowedFrom: readonly Status[];
    }
  | {
      allowed: false;
      currentStatus: Status;
      nextStatus: Status;
      allowedFrom: readonly Status[];
    };

type StatusTransitionRule<Status extends string> = {
  from: readonly Status[];
  to: Status;
};

export type PharmacyVisitRequestTransitionAction =
  | 'accept'
  | 'decline'
  | 'submit_partner_record'
  | 'confirm_partner_record'
  | 'return_partner_record'
  | 'create_physician_report'
  | 'mark_claim_checked';

export type PartnerVisitRecordTransitionAction = 'submit' | 'confirm' | 'return';

const ACTIVATABLE_SHARE_CASE_STATUSES = new Set<PatientShareCaseLifecycleStatus>([
  'partner_confirmation_pending',
  'suspended',
]);

const NON_TERMINAL_SHARE_CASE_STATUSES = [
  'draft',
  'consent_pending',
  'partner_confirmation_pending',
  'active',
  'suspended',
] as const satisfies readonly PatientShareCaseLifecycleStatus[];

const PATIENT_SHARE_CASE_TRANSITION_ALLOWED_FROM = {
  register_consent: NON_TERMINAL_SHARE_CASE_STATUSES,
  approve_patient_link: NON_TERMINAL_SHARE_CASE_STATUSES,
  accept_patient_link: NON_TERMINAL_SHARE_CASE_STATUSES,
  decline_patient_link: ['draft', 'consent_pending', 'partner_confirmation_pending', 'suspended'],
  revoke_consent: NON_TERMINAL_SHARE_CASE_STATUSES,
  activate: ['partner_confirmation_pending', 'suspended'],
} as const satisfies Record<
  PatientShareCaseTransitionAction,
  readonly PatientShareCaseLifecycleStatus[]
>;

const SUBMITTABLE_RECORD_STATUSES = new Set<PartnerVisitRecordLifecycleStatus>([
  'draft',
  'returned',
]);

const PHARMACY_VISIT_REQUEST_TRANSITION_RULES = {
  accept: { from: ['requested'], to: 'accepted' },
  decline: { from: ['requested'], to: 'declined' },
  submit_partner_record: { from: ['accepted', 'recording', 'returned'], to: 'submitted' },
  confirm_partner_record: { from: ['submitted'], to: 'confirmed' },
  return_partner_record: { from: ['submitted'], to: 'returned' },
  create_physician_report: { from: ['confirmed'], to: 'physician_report_created' },
  mark_claim_checked: { from: ['confirmed', 'physician_report_created'], to: 'claim_checked' },
} as const satisfies Record<
  PharmacyVisitRequestTransitionAction,
  StatusTransitionRule<PharmacyVisitRequestLifecycleStatus>
>;

const PARTNER_VISIT_RECORD_TRANSITION_RULES = {
  submit: { from: ['draft', 'returned'], to: 'submitted' },
  confirm: { from: ['submitted'], to: 'confirmed' },
  return: { from: ['submitted'], to: 'returned' },
} as const satisfies Record<
  PartnerVisitRecordTransitionAction,
  StatusTransitionRule<PartnerVisitRecordLifecycleStatus>
>;

function resolveStatusTransition<Status extends string, Action extends string>(
  rules: Record<Action, StatusTransitionRule<Status>>,
  args: { currentStatus: Status; action: Action },
): StatusTransitionResult<Status> {
  const rule = rules[args.action];
  const allowed = rule.from.includes(args.currentStatus);

  return {
    allowed,
    currentStatus: args.currentStatus,
    nextStatus: rule.to,
    allowedFrom: rule.from,
  } as StatusTransitionResult<Status>;
}

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

export function resolvePharmacyVisitRequestTransition(args: {
  currentStatus: PharmacyVisitRequestLifecycleStatus;
  action: PharmacyVisitRequestTransitionAction;
}) {
  return resolveStatusTransition(PHARMACY_VISIT_REQUEST_TRANSITION_RULES, args);
}

export function resolvePartnerVisitRecordTransition(args: {
  currentStatus: PartnerVisitRecordLifecycleStatus;
  action: PartnerVisitRecordTransitionAction;
}) {
  return resolveStatusTransition(PARTNER_VISIT_RECORD_TRANSITION_RULES, args);
}

export function resolvePatientShareCaseTransition(args: {
  currentStatus: PatientShareCaseLifecycleStatus;
  action: PatientShareCaseTransitionAction;
  hasActiveConsent?: boolean;
  patientLinkAccepted?: boolean;
  hasBaseApproval?: boolean;
  hasPartnerApproval?: boolean;
}): StatusTransitionResult<PatientShareCaseLifecycleStatus> {
  const currentStatus = args.currentStatus;
  const activeConsent = Boolean(args.hasActiveConsent);
  const allowedFrom = PATIENT_SHARE_CASE_TRANSITION_ALLOWED_FROM[args.action];

  if (!(allowedFrom as readonly PatientShareCaseLifecycleStatus[]).includes(currentStatus)) {
    return {
      allowed: false,
      currentStatus,
      nextStatus: currentStatus,
      allowedFrom,
    };
  }

  if (args.action === 'activate') {
    const allowed =
      activeConsent &&
      Boolean(args.patientLinkAccepted) &&
      Boolean(args.hasBaseApproval) &&
      Boolean(args.hasPartnerApproval);
    return {
      allowed,
      currentStatus,
      nextStatus: allowed ? 'active' : currentStatus,
      allowedFrom,
    };
  }

  if (args.action === 'revoke_consent') {
    return {
      allowed: true,
      currentStatus,
      nextStatus: 'revoked',
      allowedFrom,
    };
  }

  if (args.action === 'decline_patient_link') {
    return {
      allowed: true,
      currentStatus,
      nextStatus: 'declined',
      allowedFrom,
    };
  }

  if (args.action === 'register_consent') {
    return {
      allowed: true,
      currentStatus,
      nextStatus:
        currentStatus === 'draft' || currentStatus === 'consent_pending'
          ? 'partner_confirmation_pending'
          : currentStatus,
      allowedFrom,
    };
  }

  return {
    allowed: true,
    currentStatus,
    nextStatus:
      currentStatus === 'active' || currentStatus === 'suspended'
        ? currentStatus
        : activeConsent
          ? 'partner_confirmation_pending'
          : 'consent_pending',
    allowedFrom,
  };
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
