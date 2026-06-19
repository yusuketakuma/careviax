import type { PatientShareCaseLifecycleStatus, PharmacyOwner } from './pharmacy-partnerships';

export const PATIENT_SHARE_CORRECTION_TARGET_TYPES = [
  'patient_profile',
  'care_case',
  'management_plan',
  'visit_request',
  'partner_visit_record',
  'claim_note',
  'billing_candidate',
] as const;

export type PatientShareCorrectionTargetType =
  (typeof PATIENT_SHARE_CORRECTION_TARGET_TYPES)[number];

const CORRECTION_TARGET_OWNER_BY_TARGET_TYPE: Record<
  PatientShareCorrectionTargetType,
  PharmacyOwner
> = {
  patient_profile: 'base_pharmacy',
  care_case: 'base_pharmacy',
  management_plan: 'base_pharmacy',
  visit_request: 'base_pharmacy',
  partner_visit_record: 'partner_pharmacy',
  claim_note: 'base_pharmacy',
  billing_candidate: 'base_pharmacy',
};

export function oppositePharmacyOwner(owner: PharmacyOwner): PharmacyOwner {
  return owner === 'base_pharmacy' ? 'partner_pharmacy' : 'base_pharmacy';
}

export function getPatientShareCorrectionTargetOwner(
  targetType: PatientShareCorrectionTargetType,
): PharmacyOwner {
  return CORRECTION_TARGET_OWNER_BY_TARGET_TYPE[targetType];
}

export function canEditOwnedResource(args: {
  actorOwner: PharmacyOwner;
  resourceOwner: PharmacyOwner;
}) {
  return args.actorOwner === args.resourceOwner;
}

export function canRequestCorrection(args: {
  shareCaseStatus: PatientShareCaseLifecycleStatus;
  requesterOwner: PharmacyOwner;
  targetOwner: PharmacyOwner;
}) {
  return (
    args.shareCaseStatus === 'active' &&
    !canEditOwnedResource({
      actorOwner: args.requesterOwner,
      resourceOwner: args.targetOwner,
    })
  );
}

export function resolvePatientShareCorrectionRequestPolicy(args: {
  shareCaseStatus: PatientShareCaseLifecycleStatus;
  targetType: PatientShareCorrectionTargetType;
}) {
  const targetOwner = getPatientShareCorrectionTargetOwner(args.targetType);
  const requesterOwner = oppositePharmacyOwner(targetOwner);
  return {
    allowed: canRequestCorrection({
      shareCaseStatus: args.shareCaseStatus,
      requesterOwner,
      targetOwner,
    }),
    requesterOwner,
    targetOwner,
  };
}
