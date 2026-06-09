import {
  ActionCode,
  BoardSortKey,
  BoardQuickFilter,
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
  query?: string;
  sortKey?: BoardSortKey;
  todayKey?: string;
  serverFiltered?: boolean;
};

export type BoardFilterCounts = {
  quickFilters: Record<BoardQuickFilter, number>;
  triageLanes: Record<TriageLane, number>;
};

export const BOARD_QUICK_FILTER_ORDER = [
  BoardQuickFilter.ALL,
  BoardQuickFilter.TODAY,
  BoardQuickFilter.MY_ASSIGNED,
  BoardQuickFilter.INCOMPLETE,
  BoardQuickFilter.PHARMACIST_REVIEW,
  BoardQuickFilter.CLERK_READY,
  BoardQuickFilter.SET_AUDIT_WAITING,
  BoardQuickFilter.VISIT_READY_CHECK,
  BoardQuickFilter.REPORT_UNSENT,
  BoardQuickFilter.WAITING_REPLY,
  BoardQuickFilter.MISSING_EVIDENCE,
  BoardQuickFilter.URGENT,
] as const satisfies readonly BoardQuickFilter[];

export const TRIAGE_LANE_ORDER = [
  TriageLane.TODAY_VISIT,
  TriageLane.PHARMACIST_REVIEW,
  TriageLane.CLERK_READY,
  TriageLane.REPORT_UNSENT,
  TriageLane.WAITING_REPLY,
  TriageLane.MISSING_EVIDENCE,
] as const satisfies readonly TriageLane[];

export const BOARD_SORT_ORDER = [
  BoardSortKey.VISIT_TIME,
  BoardSortKey.URGENCY,
  BoardSortKey.STALE_TIME,
  BoardSortKey.CURRENT_STEP,
  BoardSortKey.ASSIGNEE,
  BoardSortKey.FACILITY,
  BoardSortKey.UPDATED,
] as const satisfies readonly BoardSortKey[];

const VISIT_STEPS = new Set<CurrentStep>([
  CurrentStep.VISIT_ASSIGNMENT,
  CurrentStep.VISIT_READY_CHECK,
  CurrentStep.VISIT_READY,
  CurrentStep.VISIT_IN_PROGRESS,
]);
const MISSING_EVIDENCE_BLOCKER_CODE = ['MISSING', '_EVIDENCE'].join('');

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

function hasMissingEvidenceSignal(item: CardBoardItemView): boolean {
  return (
    item.card.tags.some((tag) => tag.code === Tag.CLAIM_CANDIDATE) ||
    item.card.blocker_summary?.top.blocker_code === MISSING_EVIDENCE_BLOCKER_CODE ||
    item.card.blocker_summary?.top.message_key === 'blocker.missing_evidence'
  );
}

function hasReportUnsentSignal(item: CardBoardItemView): boolean {
  return (
    item.card.current_step === CurrentStep.REPORT ||
    item.card.current_step === CurrentStep.REPORT_SEND ||
    item.card.tags.some((tag) => tag.code === Tag.REPORT_REQUIRED) ||
    item.next_action.code === ActionCode.SEND_REPORT ||
    item.next_action.code === ActionCode.APPROVE_REPORT
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

function matchesQuickFilter(
  item: CardBoardItemView,
  quickFilter: BoardQuickFilter,
  currentUserName?: string,
  todayKey?: string,
): boolean {
  if (quickFilter !== BoardQuickFilter.ALL && item.card.quick_filter_keys) {
    return item.card.quick_filter_keys.includes(quickFilter);
  }
  switch (quickFilter) {
    case BoardQuickFilter.ALL:
      return true;
    case BoardQuickFilter.TODAY:
      return Boolean(
        todayKey &&
        (item.card.visit_date === todayKey ||
          item.card.service_date === todayKey ||
          item.card.due_at?.startsWith(todayKey)),
      );
    case BoardQuickFilter.MY_ASSIGNED:
      return Boolean(
        currentUserName && item.card.assigned_user && item.card.assigned_user === currentUserName,
      );
    case BoardQuickFilter.INCOMPLETE:
      return (
        item.card.display_status !== DisplayStatus.CLOSED &&
        item.card.display_status !== DisplayStatus.CANCELED
      );
    case BoardQuickFilter.PHARMACIST_REVIEW:
      return matchesTriageLane(item, TriageLane.PHARMACIST_REVIEW);
    case BoardQuickFilter.CLERK_READY:
      return matchesTriageLane(item, TriageLane.CLERK_READY);
    case BoardQuickFilter.SET_AUDIT_WAITING:
      return item.card.current_step === CurrentStep.SET_AUDIT;
    case BoardQuickFilter.VISIT_READY_CHECK:
      return (
        item.card.current_step === CurrentStep.VISIT_ASSIGNMENT ||
        item.card.current_step === CurrentStep.VISIT_READY_CHECK ||
        item.card.current_step === CurrentStep.VISIT_READY
      );
    case BoardQuickFilter.REPORT_UNSENT:
      return hasReportUnsentSignal(item);
    case BoardQuickFilter.WAITING_REPLY:
      return hasWaitingReplySignal(item);
    case BoardQuickFilter.MISSING_EVIDENCE:
      return hasMissingEvidenceSignal(item);
    case BoardQuickFilter.URGENT:
      return (
        hasSafetyTag(item) ||
        item.card.urgency_rank === 0 ||
        item.card.blocker_summary?.top.severity === 'CRITICAL'
      );
  }
}

function matchesTriageLane(
  item: CardBoardItemView,
  triageLane: TriageLane,
  todayKey?: string,
): boolean {
  if (item.card.triage_lanes) return item.card.triage_lanes.includes(triageLane);
  switch (triageLane) {
    case TriageLane.TODAY_VISIT:
      return Boolean(
        todayKey &&
        VISIT_STEPS.has(item.card.current_step) &&
        (item.card.visit_date === todayKey ||
          item.card.service_date === todayKey ||
          item.card.due_at?.startsWith(todayKey)),
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
    case TriageLane.REPORT_UNSENT:
      return hasReportUnsentSignal(item);
    case TriageLane.WAITING_REPLY:
      return hasWaitingReplySignal(item);
    case TriageLane.MISSING_EVIDENCE:
      return hasMissingEvidenceSignal(item) || hasClaimSignal(item);
  }
}

function normalized(value: string | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase('ja-JP');
}

function matchesQuery(item: CardBoardItemView, query: string | undefined): boolean {
  const q = normalized(query);
  if (!q) return true;
  const searchable = [
    item.card.card_id,
    item.card.patient_name,
    item.card.facility_name,
    item.card.room,
    item.card.visit_time,
    item.card.assigned_user,
    item.card.current_step,
    item.card.display_status,
    item.next_action.code,
    item.next_action.label_key,
    ...(item.card.search_texts ?? []),
    ...item.card.tags.flatMap((tag) => [tag.code, tag.label]),
    item.card.blocker_summary?.top.message_key,
    item.card.blocker_summary?.top.blocker_code,
  ];
  return searchable.some((value) => normalized(value).includes(q));
}

function compareText(left: string | undefined, right: string | undefined): number {
  return (left ?? '').localeCompare(right ?? '', 'ja-JP');
}

function compareDateDesc(left: string | undefined, right: string | undefined): number {
  return (Date.parse(right ?? '') || 0) - (Date.parse(left ?? '') || 0);
}

const CURRENT_STEP_SORT_RANK = Object.fromEntries(
  Object.values(CurrentStep).map((step, index) => [step, index]),
) as Record<CurrentStep, number>;

export function sortBoardItems(
  items: readonly CardBoardItemView[],
  sortKey: BoardSortKey = BoardSortKey.VISIT_TIME,
): CardBoardItemView[] {
  return [...items].sort((left, right) => {
    const byCardId = left.card.card_id.localeCompare(right.card.card_id);
    switch (sortKey) {
      case BoardSortKey.VISIT_TIME:
        return (
          compareText(
            left.card.visit_time ?? left.card.due_at,
            right.card.visit_time ?? right.card.due_at,
          ) || byCardId
        );
      case BoardSortKey.URGENCY:
        return (left.card.urgency_rank ?? 99) - (right.card.urgency_rank ?? 99) || byCardId;
      case BoardSortKey.STALE_TIME:
        return (right.card.stale_minutes ?? 0) - (left.card.stale_minutes ?? 0) || byCardId;
      case BoardSortKey.CURRENT_STEP:
        return (
          CURRENT_STEP_SORT_RANK[left.card.current_step] -
            CURRENT_STEP_SORT_RANK[right.card.current_step] || byCardId
        );
      case BoardSortKey.ASSIGNEE:
        return compareText(left.card.assigned_user, right.card.assigned_user) || byCardId;
      case BoardSortKey.FACILITY:
        return compareText(left.card.facility_name, right.card.facility_name) || byCardId;
      case BoardSortKey.UPDATED:
        return compareDateDesc(left.card.updated_at, right.card.updated_at) || byCardId;
    }
  });
}

export function selectBoardItems(
  items: readonly CardBoardItemView[],
  state: BoardFilterState,
): CardBoardItemView[] {
  const filtered = items.filter((item) => {
    if (!state.serverFiltered && !matchesQuery(item, state.query)) return false;
    if (
      !state.serverFiltered &&
      !matchesQuickFilter(item, state.quickFilter, state.currentUserName, state.todayKey)
    ) {
      return false;
    }
    if (!state.triageLane) return true;
    return matchesTriageLane(item, state.triageLane, state.todayKey);
  });
  return state.serverFiltered ? filtered : sortBoardItems(filtered, state.sortKey);
}

export function countBoardFilters(
  items: readonly CardBoardItemView[],
  currentUserName?: string,
  todayKey?: string,
): BoardFilterCounts {
  return {
    quickFilters: Object.fromEntries(
      BOARD_QUICK_FILTER_ORDER.map((quickFilter) => [
        quickFilter,
        items.filter((item) => matchesQuickFilter(item, quickFilter, currentUserName, todayKey))
          .length,
      ]),
    ) as Record<BoardQuickFilter, number>,
    triageLanes: Object.fromEntries(
      TRIAGE_LANE_ORDER.map((triageLane) => [
        triageLane,
        items.filter((item) => matchesTriageLane(item, triageLane, todayKey)).length,
      ]),
    ) as Record<TriageLane, number>,
  };
}
