import { describe, expect, it } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BoardSortKey,
  BoardQuickFilter,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  Tag,
  TriageLane,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type {
  CardBoardItemView,
  CardSummaryView,
  NextActionView,
  TagView,
} from '@/phos/contracts/phos_contracts';
import { countBoardFilters, selectBoardItems, sortBoardItems } from './boardFilters';

const baseAction = {
  code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  kind: ActionKind.STEP_CHANGING,
  label_key: 'action.confirm_prescription_diff',
  enabled: true,
  offline_allowed: false,
  priority: 'PRIMARY',
  required_role: [],
  target_endpoint: '/cards/card_1/actions',
  ui_state: ButtonState.ACTIONABLE,
  can_user_handle: true,
} satisfies NextActionView;

function tag(code: Tag, safety_critical = false): TagView {
  return {
    code,
    label: code,
    severity: 'WARNING',
    icon: 'tag',
    safety_critical,
  };
}

function item(
  card_id: string,
  overrides: Partial<CardSummaryView> = {},
  action: Partial<NextActionView> = {},
): CardBoardItemView {
  return {
    card: {
      card_id,
      card_type: CardType.PRESCRIPTION,
      patient_name: `患者 ${card_id}`,
      current_step: CurrentStep.DIFF_REVIEW,
      display_status: DisplayStatus.READY,
      server_version: 1,
      tags: [],
      ...overrides,
    },
    next_action: {
      ...baseAction,
      ...action,
    },
  };
}

describe('boardFilters', () => {
  it('selects the required P0 quick filters without UI-side state transitions', () => {
    const items = [
      item('today', { visit_time: '10:30', visit_date: '2026-06-09' }),
      item('mine', { assigned_user: '薬剤師A' }),
      item('closed', { display_status: DisplayStatus.CLOSED }),
      item('review', { display_status: DisplayStatus.REVIEW_REQUIRED }),
      item('clerk', { tags: [tag(Tag.CLERK_CAN_RESOLVE)] }),
      item('set-audit', { current_step: CurrentStep.SET_AUDIT }),
      item('visit-ready', { current_step: CurrentStep.VISIT_READY_CHECK }),
      item('report', { tags: [tag(Tag.REPORT_REQUIRED)] }),
      item('reply', { tags: [tag(Tag.WAITING_REPLY)] }),
      item('evidence', {
        blocker_summary: {
          top: {
            blocker_code: 'MISSING_EVIDENCE',
            severity: 'WARNING',
            owner_role: UserRole.PHARMACIST,
            message_key: 'blocker.missing_evidence',
            active: true,
          },
          blocking_count: 1,
          total_count: 1,
        },
      }),
      item('urgent', { tags: [tag(Tag.HIGH_RISK, true)], urgency_rank: 0 }),
    ];

    expect(
      selectBoardItems(items, {
        quickFilter: BoardQuickFilter.TODAY,
        todayKey: '2026-06-09',
      }).map((entry) => entry.card.card_id),
    ).toEqual(['today']);
    expect(
      selectBoardItems(items, {
        quickFilter: BoardQuickFilter.MY_ASSIGNED,
        currentUserName: '薬剤師A',
      }).map((entry) => entry.card.card_id),
    ).toEqual(['mine']);
    expect(
      selectBoardItems(items, { quickFilter: BoardQuickFilter.INCOMPLETE }).map(
        (entry) => entry.card.card_id,
      ),
    ).not.toContain('closed');
    expect(
      selectBoardItems(items, { quickFilter: BoardQuickFilter.SET_AUDIT_WAITING }).map(
        (entry) => entry.card.card_id,
      ),
    ).toEqual(['set-audit']);
    expect(
      selectBoardItems(items, { quickFilter: BoardQuickFilter.URGENT }).map(
        (entry) => entry.card.card_id,
      ),
    ).toEqual(['urgent']);
  });

  it('counts the required triage lanes', () => {
    const items = [
      item('today', {
        current_step: CurrentStep.VISIT_READY,
        visit_time: '10:30',
        visit_date: '2026-06-09',
      }),
      item('review', { display_status: DisplayStatus.REVIEW_REQUIRED }),
      item('clerk', { tags: [tag(Tag.CLERK_CAN_RESOLVE)] }),
      item('report', { tags: [tag(Tag.REPORT_REQUIRED)] }),
      item('reply', { tags: [tag(Tag.WAITING_REPLY)] }),
      item('evidence', {
        blocker_summary: {
          top: {
            blocker_code: 'MISSING_EVIDENCE',
            severity: 'WARNING',
            owner_role: UserRole.PHARMACIST,
            message_key: 'blocker.missing_evidence',
            active: true,
          },
          blocking_count: 1,
          total_count: 1,
        },
      }),
    ];

    const counts = countBoardFilters(items, '薬剤師A', '2026-06-09');

    expect(counts.triageLanes[TriageLane.TODAY_VISIT]).toBe(1);
    expect(counts.triageLanes[TriageLane.PHARMACIST_REVIEW]).toBe(2);
    expect(counts.triageLanes[TriageLane.CLERK_READY]).toBe(1);
    expect(counts.triageLanes[TriageLane.REPORT_UNSENT]).toBe(1);
    expect(counts.triageLanes[TriageLane.WAITING_REPLY]).toBe(1);
    expect(counts.triageLanes[TriageLane.MISSING_EVIDENCE]).toBe(1);
  });

  it('combines quick filter and triage lane selections', () => {
    const items = [
      item('blocked-clerk', {
        display_status: DisplayStatus.BLOCKED,
        tags: [tag(Tag.CLERK_CAN_RESOLVE)],
        blocker_summary: {
          top: {
            blocker_code: 'MISSING_EVIDENCE',
            severity: 'WARNING',
            owner_role: UserRole.PHARMACY_CLERK,
            message_key: 'blocker.missing_evidence',
            active: true,
          },
          blocking_count: 1,
          total_count: 1,
        },
      }),
      item('blocked-other', { display_status: DisplayStatus.BLOCKED }),
      item('ready-clerk', { tags: [tag(Tag.CLERK_CAN_RESOLVE)] }),
    ];

    expect(
      selectBoardItems(items, {
        quickFilter: BoardQuickFilter.MISSING_EVIDENCE,
        triageLane: TriageLane.CLERK_READY,
      }).map((entry) => entry.card.card_id),
    ).toEqual(['blocked-clerk']);
  });

  it('searches board L0 fields and sorts by P0 sort options', () => {
    const items = [
      item('b', {
        patient_name: '患者 佐藤花子',
        facility_name: '青空ホーム',
        visit_time: '11:00',
        stale_minutes: 5,
        updated_at: '2026-06-09T01:00:00.000Z',
      }),
      item('a', {
        patient_name: '患者 山田太郎',
        facility_name: 'みどり施設',
        visit_time: '09:00',
        stale_minutes: 120,
        updated_at: '2026-06-09T02:00:00.000Z',
      }),
    ];

    expect(
      selectBoardItems(items, { quickFilter: BoardQuickFilter.ALL, query: '山田' }).map(
        (entry) => entry.card.card_id,
      ),
    ).toEqual(['a']);
    expect(
      sortBoardItems(items, BoardSortKey.VISIT_TIME).map((entry) => entry.card.card_id),
    ).toEqual(['a', 'b']);
    expect(
      sortBoardItems(items, BoardSortKey.STALE_TIME).map((entry) => entry.card.card_id),
    ).toEqual(['a', 'b']);
    expect(sortBoardItems(items, BoardSortKey.UPDATED).map((entry) => entry.card.card_id)).toEqual([
      'a',
      'b',
    ]);
  });
});
