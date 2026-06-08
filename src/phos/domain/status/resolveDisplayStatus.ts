import {
  BlockerSeverity,
  CurrentStep,
  DisplayStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { BlockerView } from '@/phos/contracts/phos_contracts';

export const ACTION_EXECUTABLE_STEPS: readonly CurrentStep[] = [
  CurrentStep.INTAKE,
  CurrentStep.DIFF_REVIEW,
  CurrentStep.SET_PREP,
  CurrentStep.VISIT_ASSIGNMENT,
  CurrentStep.VISIT_READY_CHECK,
  CurrentStep.VISIT_READY,
  CurrentStep.REPORT,
  CurrentStep.REPORT_SEND,
  CurrentStep.CLAIM_REVIEW,
  CurrentStep.CLOSING,
];

export const isBlockingSeverity = (severity: BlockerSeverity) =>
  severity === BlockerSeverity.ERROR || severity === BlockerSeverity.CRITICAL;

export const isPharmacistReviewRequired = (blockers: BlockerView[]) =>
  blockers.some(
    (blocker) =>
      blocker.active &&
      blocker.owner_role === UserRole.PHARMACIST &&
      !isBlockingSeverity(blocker.severity),
  );

export type DisplayStatusInput = {
  canceled_at?: string | null;
  current_step: CurrentStep;
  blockers: BlockerView[];
  has_open_rejected_audit: boolean;
  has_active_in_progress_task: boolean;
  primary_action_authorized: boolean;
};

export function resolveDisplayStatus(input: DisplayStatusInput): DisplayStatus {
  if (input.canceled_at != null) return DisplayStatus.CANCELED;
  if (input.current_step === CurrentStep.CLOSED) return DisplayStatus.CLOSED;
  if (input.blockers.some((blocker) => blocker.active && isBlockingSeverity(blocker.severity))) {
    return DisplayStatus.BLOCKED;
  }
  if (input.has_open_rejected_audit) return DisplayStatus.REJECTED;
  if (input.has_active_in_progress_task) return DisplayStatus.IN_PROGRESS;
  if (isPharmacistReviewRequired(input.blockers)) return DisplayStatus.REVIEW_REQUIRED;
  if (ACTION_EXECUTABLE_STEPS.includes(input.current_step) && input.primary_action_authorized) {
    return DisplayStatus.READY;
  }
  return DisplayStatus.WAITING;
}
