import type { PatientShareCaseLifecycleStatus, PharmacyOwner } from './pharmacy-partnerships';
import { enabledPatientShareScopeKeys, type PatientShareScopeKey } from './patient-share-scope';

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

export const PATIENT_SHARE_DATA_OUTPUT_ACTIONS = [
  'view_attachment',
  'download_attachment',
  'print',
  'pdf_output',
  'download_pdf',
  'download_data',
] as const;

export type PatientShareDataOutputAction = (typeof PATIENT_SHARE_DATA_OUTPUT_ACTIONS)[number];

export type PatientShareDataOutputPolicyBlocker = 'inactive_share_case' | 'missing_share_scope';

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

const REQUIRED_SCOPE_KEYS_BY_DATA_OUTPUT_ACTION: Record<
  PatientShareDataOutputAction,
  readonly PatientShareScopeKey[]
> = {
  view_attachment: ['attachments'],
  download_attachment: ['attachments', 'download'],
  print: ['print'],
  pdf_output: ['pdf_output'],
  download_pdf: ['pdf_output', 'download'],
  download_data: ['download'],
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

export function requiredPatientShareScopeKeysForDataOutput(action: PatientShareDataOutputAction) {
  return REQUIRED_SCOPE_KEYS_BY_DATA_OUTPUT_ACTION[action];
}

export function resolvePatientShareDataOutputPolicy(args: {
  shareCaseStatus: PatientShareCaseLifecycleStatus;
  shareScope: unknown;
  action: PatientShareDataOutputAction;
}) {
  const requiredScopeKeys = requiredPatientShareScopeKeysForDataOutput(args.action);
  const enabledScopeKeys = enabledPatientShareScopeKeys(args.shareScope);
  const enabledScopeKeySet = new Set(enabledScopeKeys);
  const missingScopeKeys = requiredScopeKeys.filter((key) => !enabledScopeKeySet.has(key));
  const blocker: PatientShareDataOutputPolicyBlocker | undefined =
    args.shareCaseStatus !== 'active'
      ? 'inactive_share_case'
      : missingScopeKeys.length > 0
        ? 'missing_share_scope'
        : undefined;

  return {
    allowed: blocker === undefined,
    action: args.action,
    requiredScopeKeys,
    enabledScopeKeys,
    missingScopeKeys,
    blocker,
  };
}

export function canExportSharedData(args: {
  shareCaseStatus: PatientShareCaseLifecycleStatus;
  shareScope: unknown;
  action: PatientShareDataOutputAction;
}) {
  return resolvePatientShareDataOutputPolicy(args).allowed;
}

export function allowedPatientShareDataOutputActions(args: {
  shareCaseStatus: PatientShareCaseLifecycleStatus;
  shareScope: unknown;
}) {
  return PATIENT_SHARE_DATA_OUTPUT_ACTIONS.filter((action) =>
    canExportSharedData({ ...args, action }),
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
