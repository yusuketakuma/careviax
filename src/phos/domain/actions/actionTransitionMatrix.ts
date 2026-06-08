import {
  ActionCode,
  ActionKind,
  CurrentStep,
  DisplayStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionCode as ActionCodeType,
  ActionKind as ActionKindType,
} from '@/phos/contracts/phos_contracts';

export type ActionTransition = {
  kind: ActionKindType;
  from: CurrentStep | 'any except CLOSED' | 'report_delivery' | 'evidence' | 'handoff' | 'blocker';
  to: CurrentStep | string;
  required_role?: UserRole[];
  reason_required?: boolean;
};

export const ACTION_TRANSITION_MATRIX = {
  [ActionCode.REGISTER_PRESCRIPTION]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.INTAKE,
    to: CurrentStep.DIFF_REVIEW,
    required_role: [UserRole.PHARMACIST, UserRole.PHARMACY_CLERK],
  },
  [ActionCode.CONFIRM_PRESCRIPTION_DIFF]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.DIFF_REVIEW,
    to: CurrentStep.DISPENSING,
    required_role: [UserRole.PHARMACIST],
  },
  [ActionCode.START_DISPENSING]: {
    kind: ActionKind.INTRA_STEP,
    from: CurrentStep.DISPENSING,
    to: 'DISPENSING.IN_PROGRESS',
  },
  [ActionCode.COMPLETE_DISPENSING]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.DISPENSING,
    to: CurrentStep.DISPENSING_AUDIT,
  },
  [ActionCode.START_DISPENSING_AUDIT]: {
    kind: ActionKind.INTRA_STEP,
    from: CurrentStep.DISPENSING_AUDIT,
    to: 'DISPENSING_AUDIT.IN_PROGRESS',
  },
  [ActionCode.APPROVE_DISPENSING_AUDIT]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.DISPENSING_AUDIT,
    to: CurrentStep.SET_PREP,
  },
  [ActionCode.REJECT_DISPENSING_AUDIT]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.DISPENSING_AUDIT,
    to: CurrentStep.DISPENSING,
    reason_required: true,
  },
  [ActionCode.CREATE_SET_INSTRUCTION]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.SET_PREP,
    to: CurrentStep.SETTING,
  },
  [ActionCode.COMPLETE_SET]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.SETTING,
    to: CurrentStep.SET_AUDIT,
  },
  [ActionCode.START_SET_AUDIT]: {
    kind: ActionKind.INTRA_STEP,
    from: CurrentStep.SET_AUDIT,
    to: 'SET_AUDIT.IN_PROGRESS',
  },
  [ActionCode.APPROVE_SET_AUDIT]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.SET_AUDIT,
    to: CurrentStep.VISIT_ASSIGNMENT,
  },
  [ActionCode.REJECT_SET_AUDIT]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.SET_AUDIT,
    to: CurrentStep.SETTING,
    reason_required: true,
  },
  [ActionCode.ASSIGN_TO_VISIT_PACKET]: {
    kind: ActionKind.INTRA_STEP,
    from: CurrentStep.VISIT_ASSIGNMENT,
    to: CurrentStep.VISIT_ASSIGNMENT,
  },
  [ActionCode.SCHEDULE_VISIT_PACKET]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.VISIT_ASSIGNMENT,
    to: CurrentStep.VISIT_READY_CHECK,
  },
  [ActionCode.CONFIRM_VISIT_READY]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.VISIT_READY_CHECK,
    to: CurrentStep.VISIT_READY,
  },
  [ActionCode.START_VISIT]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.VISIT_READY,
    to: CurrentStep.VISIT_IN_PROGRESS,
  },
  [ActionCode.COMPLETE_VISIT]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.VISIT_IN_PROGRESS,
    to: CurrentStep.REPORT,
  },
  [ActionCode.CREATE_REPORT_DRAFT]: {
    kind: ActionKind.INTRA_STEP,
    from: CurrentStep.REPORT,
    to: CurrentStep.REPORT,
  },
  [ActionCode.APPROVE_REPORT]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.REPORT,
    to: CurrentStep.REPORT_SEND,
  },
  [ActionCode.SEND_REPORT]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.REPORT_SEND,
    to: CurrentStep.CLAIM_REVIEW,
  },
  [ActionCode.MARK_REPORT_WAITING_REPLY]: {
    kind: ActionKind.DETACHED,
    from: 'report_delivery',
    to: 'WAITING_REPLY',
  },
  [ActionCode.REGISTER_REPORT_REPLY]: {
    kind: ActionKind.DETACHED,
    from: 'report_delivery',
    to: 'REPLIED/ACTION_REQUIRED/ACTION_DONE',
  },
  [ActionCode.MARK_REPORT_ACTION_DONE]: {
    kind: ActionKind.DETACHED,
    from: 'report_delivery',
    to: 'ACTION_DONE',
  },
  [ActionCode.REVIEW_CLAIM_CANDIDATES]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.CLAIM_REVIEW,
    to: CurrentStep.CLOSING,
  },
  [ActionCode.EXCLUDE_CLAIM_CANDIDATE]: {
    kind: ActionKind.INTRA_STEP,
    from: CurrentStep.CLAIM_REVIEW,
    to: CurrentStep.CLAIM_REVIEW,
    reason_required: true,
  },
  [ActionCode.CLOSE_CARD]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.CLOSING,
    to: CurrentStep.CLOSED,
  },
  [ActionCode.REOPEN_CARD]: {
    kind: ActionKind.STEP_CHANGING,
    from: CurrentStep.CLOSED,
    to: 'previous/specified',
    reason_required: true,
  },
  [ActionCode.CANCEL_CARD]: {
    kind: ActionKind.STEP_CHANGING,
    from: 'any except CLOSED',
    to: DisplayStatus.CANCELED,
    reason_required: true,
  },
  [ActionCode.UPLOAD_EVIDENCE]: {
    kind: ActionKind.DETACHED,
    from: 'evidence',
    to: 'evidence.saved',
  },
  [ActionCode.CREATE_HANDOFF_TO_PHARMACIST]: {
    kind: ActionKind.DETACHED,
    from: 'handoff',
    to: 'handoff.OPEN',
  },
  [ActionCode.RESOLVE_CLERK_BLOCKER]: {
    kind: ActionKind.DETACHED,
    from: 'blocker',
    to: 'blocker.resolved',
  },
} as const satisfies Record<ActionCodeType, ActionTransition>;

export const ACTION_KIND_BY_CODE = Object.fromEntries(
  Object.entries(ACTION_TRANSITION_MATRIX).map(([code, transition]) => [code, transition.kind]),
) as Record<ActionCodeType, ActionKindType>;
