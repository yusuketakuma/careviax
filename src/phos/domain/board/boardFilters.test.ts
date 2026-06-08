import { describe, expect, it } from 'vitest';
import {
  ActionCode,
  ActionKind,
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
import { countBoardFilters, selectBoardItems } from './boardFilters';

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
  it('selects actionable, safety, and visit quick filters without UI-side business checks', () => {
    const items = [
      item('actionable'),
      item('safety', { tags: [tag(Tag.HIGH_RISK, true)] }),
      item('visit', { current_step: CurrentStep.VISIT_READY }),
      item('blocked-action', {}, { enabled: false, ui_state: ButtonState.FOREIGN_BLOCK }),
    ];

    expect(
      selectBoardItems(items, { quickFilter: BoardQuickFilter.ACTIONABLE }).map(
        (entry) => entry.card.card_id,
      ),
    ).toEqual(['actionable', 'safety', 'visit']);
    expect(
      selectBoardItems(items, { quickFilter: BoardQuickFilter.SAFETY }).map(
        (entry) => entry.card.card_id,
      ),
    ).toEqual(['safety']);
    expect(
      selectBoardItems(items, { quickFilter: BoardQuickFilter.VISIT }).map(
        (entry) => entry.card.card_id,
      ),
    ).toEqual(['visit']);
  });

  it('counts the required triage lanes', () => {
    const items = [
      item('mine', { assigned_user: '薬剤師A' }),
      item('review', { display_status: DisplayStatus.REVIEW_REQUIRED }),
      item('clerk', { tags: [tag(Tag.CLERK_CAN_RESOLVE)] }),
      item('reply', { tags: [tag(Tag.WAITING_REPLY)] }),
      item('claim', { current_step: CurrentStep.CLAIM_REVIEW }),
      item('pharmacist-blocker', {
        blocker_summary: {
          top: {
            blocker_code: 'need_pharmacist',
            severity: 'WARNING',
            owner_role: UserRole.PHARMACIST,
            message_key: 'blocker.need_pharmacist',
            active: true,
          },
          blocking_count: 1,
          total_count: 1,
        },
      }),
    ];

    const counts = countBoardFilters(items, '薬剤師A');

    expect(counts.triageLanes[TriageLane.MY_ASSIGNED]).toBe(1);
    expect(counts.triageLanes[TriageLane.PHARMACIST_REVIEW]).toBe(2);
    expect(counts.triageLanes[TriageLane.CLERK_READY]).toBe(1);
    expect(counts.triageLanes[TriageLane.WAITING_REPLY]).toBe(1);
    expect(counts.triageLanes[TriageLane.CLAIM_MISSING]).toBe(1);
  });

  it('combines quick filter and triage lane selections', () => {
    const items = [
      item('blocked-clerk', {
        display_status: DisplayStatus.BLOCKED,
        tags: [tag(Tag.CLERK_CAN_RESOLVE)],
      }),
      item('blocked-other', { display_status: DisplayStatus.BLOCKED }),
      item('ready-clerk', { tags: [tag(Tag.CLERK_CAN_RESOLVE)] }),
    ];

    expect(
      selectBoardItems(items, {
        quickFilter: BoardQuickFilter.BLOCKED,
        triageLane: TriageLane.CLERK_READY,
      }).map((entry) => entry.card.card_id),
    ).toEqual(['blocked-clerk']);
  });
});
