export type PatientShareCaseLifecycleStatus =
  | 'draft'
  | 'consent_pending'
  | 'partner_confirmation_pending'
  | 'active'
  | 'suspended'
  | 'revoked'
  | 'ended'
  | 'declined';

export type PharmacyOwner = 'base_pharmacy' | 'partner_pharmacy';
