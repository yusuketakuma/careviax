// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BoardDensity,
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

const secondItem = {
  card: {
    ...card,
    card_id: 'card_2',
    patient_name: '患者 佐藤花子',
  },
  next_action: {
    ...nextAction,
    target_endpoint: '/cards/card_2/actions',
  },
} satisfies CardBoardItemView;

describe('CardBoard', () => {
  const baseProps = {
    totalItemCount: 1,
    density: BoardDensity.COMFORTABLE,
    searchQuery: '',
    sortKey: BoardSortKey.VISIT_TIME,
    quickFilter: BoardQuickFilter.ALL,
    counts: countBoardFilters([item]),
    onSearchQueryChange: vi.fn(),
    onSortChange: vi.fn(),
    onDensityChange: vi.fn(),
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
        density={BoardDensity.COMFORTABLE}
        searchQuery=""
        sortKey={BoardSortKey.VISIT_TIME}
        quickFilter={BoardQuickFilter.ALL}
        counts={countBoardFilters([])}
        onSearchQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onDensityChange={vi.fn()}
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
        density={BoardDensity.COMFORTABLE}
        searchQuery="山田"
        sortKey={BoardSortKey.VISIT_TIME}
        quickFilter={BoardQuickFilter.MISSING_EVIDENCE}
        counts={countBoardFilters([item])}
        onSearchQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onDensityChange={vi.fn()}
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
        density={BoardDensity.COMFORTABLE}
        searchQuery=""
        sortKey={BoardSortKey.VISIT_TIME}
        quickFilter={BoardQuickFilter.ALL}
        counts={countBoardFilters([])}
        onSearchQueryChange={vi.fn()}
        onSortChange={vi.fn()}
        onDensityChange={vi.fn()}
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

  it('requests density changes from the controlled density toggle', () => {
    const onDensityChange = vi.fn();
    render(
      <CardBoard
        items={[item]}
        onOpen={vi.fn()}
        {...baseProps}
        onDensityChange={onDensityChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'コンパクト' }));

    expect(screen.getByRole('button', { name: '標準' }).getAttribute('aria-pressed')).toBe('true');
    expect(onDensityChange).toHaveBeenCalledWith(BoardDensity.COMPACT);
  });

  it('moves card focus with j and k while focus is on a card tile', () => {
    render(
      <CardBoard items={[item, secondItem]} onOpen={vi.fn()} {...baseProps} totalItemCount={2} />,
    );

    const firstCard = screen.getByRole('button', { name: /患者 山田太郎/ });
    const secondCard = screen.getByRole('button', { name: /患者 佐藤花子/ });
    firstCard.focus();

    fireEvent.keyDown(firstCard, { key: 'j' });
    expect(document.activeElement).toBe(secondCard);

    fireEvent.keyDown(secondCard, { key: 'k' });
    expect(document.activeElement).toBe(firstCard);
  });

  it('does not hijack j or k while focus is inside search input', () => {
    const onSearchQueryChange = vi.fn();
    render(
      <CardBoard
        items={[item, secondItem]}
        onOpen={vi.fn()}
        {...baseProps}
        totalItemCount={2}
        onSearchQueryChange={onSearchQueryChange}
      />,
    );

    const search = screen.getByPlaceholderText('患者名・施設名・薬剤名・担当者で検索');
    search.focus();
    fireEvent.keyDown(search, { key: 'j' });

    expect(document.activeElement).toBe(search);
  });
});
