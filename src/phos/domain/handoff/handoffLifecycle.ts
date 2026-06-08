import { ActionCode, HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type { HandoffView, SideEffect } from '@/phos/contracts/phos_contracts';

export type HandoffTransitionResult = {
  status: HandoffStatus;
  resolved_action_code?: ActionCode;
  return_reason_code?: string;
  return_note?: string;
  side_effects: SideEffect[];
};

const URGENCY_RANK = {
  [HandoffUrgency.LOW]: 0,
  [HandoffUrgency.NORMAL]: 1,
  [HandoffUrgency.HIGH]: 2,
  [HandoffUrgency.URGENT]: 3,
} as const satisfies Record<HandoffUrgency, number>;

export function sortHandoffQueue(handoffs: readonly HandoffView[]): HandoffView[] {
  return [...handoffs].sort((left, right) => {
    const urgencyDelta = URGENCY_RANK[right.urgency] - URGENCY_RANK[left.urgency];
    if (urgencyDelta !== 0) return urgencyDelta;
    return right.age_minutes - left.age_minutes;
  });
}

export function openHandoffForReview(handoff: HandoffView): HandoffTransitionResult {
  if (handoff.status !== HandoffStatus.OPEN) {
    throw new Error('Only OPEN handoffs can move to review.');
  }
  return { status: HandoffStatus.IN_REVIEW, side_effects: [] };
}

export function resolveHandoff(input: {
  handoff: HandoffView;
  resolved_action_code: ActionCode;
  related_blocker_code?: string;
}): HandoffTransitionResult {
  if (input.handoff.status !== HandoffStatus.IN_REVIEW) {
    throw new Error('Only IN_REVIEW handoffs can be resolved.');
  }
  return {
    status: HandoffStatus.RESOLVED,
    resolved_action_code: input.resolved_action_code,
    side_effects: input.related_blocker_code
      ? [{ type: 'BLOCKER_RESOLVED', blocker_code: input.related_blocker_code }]
      : [],
  };
}

export function returnHandoff(input: {
  handoff: HandoffView;
  return_reason_code: string;
  return_note: string;
}): HandoffTransitionResult {
  if (input.handoff.status !== HandoffStatus.IN_REVIEW) {
    throw new Error('Only IN_REVIEW handoffs can be returned.');
  }
  if (!input.return_reason_code.trim() || !input.return_note.trim()) {
    throw new Error('Return reason and note are required.');
  }
  return {
    status: HandoffStatus.RETURNED,
    return_reason_code: input.return_reason_code,
    return_note: input.return_note,
    side_effects: [],
  };
}
