// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BoardSortKey,
  BoardQuickFilter,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
} from '@/phos/contracts/phos_contracts';
import type {
  CardBoardItemView,
  CardSummaryView,
  NextActionView,
} from '@/phos/contracts/phos_contracts';
import { countBoardFilters } from '@/phos/domain/board/boardFilters';
import { CardBoard } from './CardBoard';

const card = {
  card_id: 'card_1',
  card_type: CardType.PRESCRIPTION,
  patient_name: '患者 山田太郎',
  current_step: CurrentStep.DIFF_REVIEW,
  display_status: DisplayStatus.READY,
  server_version: 1,
  tags: [],
} satisfies CardSummaryView;

const nextAction = {
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

const item = {
  card,
  next_action: nextAction,
} satisfies CardBoardItemView;

describe('CardBoard', () => {
  const baseProps = {
    totalItemCount: 1,
    searchQuery: '',
    sortKey: BoardSortKey.VISIT_TIME,
    quickFilter: BoardQuickFilter.ALL,
    counts: countBoardFilters([item]),
    onSearchQueryChange: vi.fn(),
    onSortChange: vi.fn(),
    onQuickFilterChange: vi.fn(),
    onTriageLaneChange: vi.fn(),
    onResetFilters: vi.fn(),
    onPrimaryAction: vi.fn(),
  };

  it('renders card tiles and delegates card opening', () => {
    const onOpen = vi.fn();
    render(<CardBoard items={[item]} onOpen={onOpen} {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));

    expect(screen.getByRole('heading', { name: 'PH-OS' })).toBeTruthy();
    expect(screen.getByText('1 / 1件')).toBeTruthy();
    expect(onOpen).toHaveBeenCalledWith('card_1');
  });

  it('renders the canonical empty state', () => {
    render(
      <CardBoard
        items={[]}
        totalItemCount={0}
        searchQuery=""
        sortKey={BoardSortKey.VISIT_TIME}
        quickFilter={BoardQuickFilter.ALL}
        counts={countBoardFilters([])}
        onSearchQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onQuickFilterChange={vi.fn()}
        onTriageLaneChange={vi.fn()}
        onResetFilters={vi.fn()}
        onOpen={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByText('本日対応予定のカードはありません。')).toBeTruthy();
  });

  it('renders filter-empty copy and reset action when cards exist but no item matches', () => {
    const onResetFilters = vi.fn();

    render(
      <CardBoard
        items={[]}
        totalItemCount={1}
        searchQuery="山田"
        sortKey={BoardSortKey.VISIT_TIME}
        quickFilter={BoardQuickFilter.MISSING_EVIDENCE}
        counts={countBoardFilters([item])}
        onSearchQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onQuickFilterChange={vi.fn()}
        onTriageLaneChange={vi.fn()}
        onResetFilters={onResetFilters}
        onOpen={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '検索条件を解除' }));

    expect(screen.getByText('条件に一致するカードはありません。')).toBeTruthy();
    expect(onResetFilters).toHaveBeenCalledWith();
  });

  it('renders a stable loading skeleton instead of the empty state', () => {
    render(
      <CardBoard
        items={[]}
        totalItemCount={0}
        phase="LOADING"
        searchQuery=""
        sortKey={BoardSortKey.VISIT_TIME}
        quickFilter={BoardQuickFilter.ALL}
        counts={countBoardFilters([])}
        onSearchQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onQuickFilterChange={vi.fn()}
        onTriageLaneChange={vi.fn()}
        onResetFilters={vi.fn()}
        onOpen={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('カード読み込み中')).toBeTruthy();
    expect(screen.queryByText('本日対応予定のカードはありません。')).toBeNull();
  });
});
