import {
  ActionCode,
  BoardQuickFilter,
  ButtonState,
  CurrentStep,
  DisplayStatus,
  SAFETY_CRITICAL_TAGS,
  Tag,
  TriageLane,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { CardBoardItemView } from '@/phos/contracts/phos_contracts';

export type BoardFilterState = {
  quickFilter: BoardQuickFilter;
  triageLane?: TriageLane;
  currentUserName?: string;
};

export type BoardFilterCounts = {
  quickFilters: Record<BoardQuickFilter, number>;
  triageLanes: Record<TriageLane, number>;
};

export const BOARD_QUICK_FILTER_ORDER = [
  BoardQuickFilter.ALL,
  BoardQuickFilter.ACTIONABLE,
  BoardQuickFilter.BLOCKED,
  BoardQuickFilter.SAFETY,
  BoardQuickFilter.VISIT,
] as const satisfies readonly BoardQuickFilter[];

export const TRIAGE_LANE_ORDER = [
  TriageLane.MY_ASSIGNED,
  TriageLane.PHARMACIST_REVIEW,
  TriageLane.CLERK_READY,
  TriageLane.WAITING_REPLY,
  TriageLane.CLAIM_MISSING,
] as const satisfies readonly TriageLane[];

const VISIT_STEPS = new Set<CurrentStep>([
  CurrentStep.VISIT_ASSIGNMENT,
  CurrentStep.VISIT_READY_CHECK,
  CurrentStep.VISIT_READY,
  CurrentStep.VISIT_IN_PROGRESS,
]);

function hasSafetyTag(item: CardBoardItemView): boolean {
  return item.card.tags.some(
    (tag) => tag.safety_critical || SAFETY_CRITICAL_TAGS.includes(tag.code),
  );
}

function hasClaimSignal(item: CardBoardItemView): boolean {
  return (
    item.card.current_step === CurrentStep.CLAIM_REVIEW ||
    item.card.tags.some((tag) => tag.code === Tag.CLAIM_CANDIDATE) ||
    item.card.blocker_summary?.top.blocker_code.toLowerCase().includes('claim') === true
  );
}

function hasWaitingReplySignal(item: CardBoardItemView): boolean {
  return (
    item.card.tags.some((tag) => tag.code === Tag.WAITING_REPLY) ||
    item.next_action.code === ActionCode.REGISTER_REPORT_REPLY ||
    (item.card.display_status === DisplayStatus.WAITING &&
      item.card.current_step === CurrentStep.REPORT_SEND)
  );
}

function matchesQuickFilter(item: CardBoardItemView, quickFilter: BoardQuickFilter): boolean {
  switch (quickFilter) {
    case BoardQuickFilter.ALL:
      return true;
    case BoardQuickFilter.ACTIONABLE:
      return item.next_action.enabled && item.next_action.ui_state === ButtonState.ACTIONABLE;
    case BoardQuickFilter.BLOCKED:
      return (
        item.card.display_status === DisplayStatus.BLOCKED ||
        (item.card.blocker_summary?.blocking_count ?? 0) > 0
      );
    case BoardQuickFilter.SAFETY:
      return hasSafetyTag(item);
    case BoardQuickFilter.VISIT:
      return VISIT_STEPS.has(item.card.current_step);
  }
}

function matchesTriageLane(
  item: CardBoardItemView,
  triageLane: TriageLane,
  currentUserName?: string,
): boolean {
  switch (triageLane) {
    case TriageLane.MY_ASSIGNED:
      return Boolean(
        currentUserName && item.card.assigned_user && item.card.assigned_user === currentUserName,
      );
    case TriageLane.PHARMACIST_REVIEW:
      return (
        item.card.display_status === DisplayStatus.REVIEW_REQUIRED ||
        item.card.blocker_summary?.top.owner_role === UserRole.PHARMACIST
      );
    case TriageLane.CLERK_READY:
      return (
        item.card.tags.some((tag) => tag.code === Tag.CLERK_CAN_RESOLVE) ||
        item.card.blocker_summary?.top.owner_role === UserRole.PHARMACY_CLERK
      );
    case TriageLane.WAITING_REPLY:
      return hasWaitingReplySignal(item);
    case TriageLane.CLAIM_MISSING:
      return hasClaimSignal(item);
  }
}

export function selectBoardItems(
  items: readonly CardBoardItemView[],
  state: BoardFilterState,
): CardBoardItemView[] {
  return items.filter((item) => {
    if (!matchesQuickFilter(item, state.quickFilter)) return false;
    if (!state.triageLane) return true;
    return matchesTriageLane(item, state.triageLane, state.currentUserName);
  });
}

export function countBoardFilters(
  items: readonly CardBoardItemView[],
  currentUserName?: string,
): BoardFilterCounts {
  return {
    quickFilters: Object.fromEntries(
      BOARD_QUICK_FILTER_ORDER.map((quickFilter) => [
        quickFilter,
        items.filter((item) => matchesQuickFilter(item, quickFilter)).length,
      ]),
    ) as Record<BoardQuickFilter, number>,
    triageLanes: Object.fromEntries(
      TRIAGE_LANE_ORDER.map((triageLane) => [
        triageLane,
        items.filter((item) => matchesTriageLane(item, triageLane, currentUserName)).length,
      ]),
    ) as Record<TriageLane, number>,
  };
}
