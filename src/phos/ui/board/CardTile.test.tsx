// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  BoardDensity,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  Tag,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { CardSummaryView, NextActionView, TagView } from '@/phos/contracts/phos_contracts';
import { CardTile } from './CardTile';

function tag(code: Tag, label: string, safety_critical: boolean): TagView {
  return {
    code,
    label,
    severity: safety_critical ? BlockerSeverity.ERROR : BlockerSeverity.WARNING,
    icon: 'tag',
    safety_critical,
  };
}

const tags = [
  tag(Tag.NARCOTIC, '麻薬', true),
  tag(Tag.OPIOID, 'オピオイド', true),
  tag(Tag.HIGH_RISK, 'ハイリスク', true),
  tag(Tag.COLD_CHAIN, '冷所', true),
  tag(Tag.RESIDUAL, '残薬', false),
  tag(Tag.REPORT_REQUIRED, '報告必須', false),
  tag(Tag.CLAIM_CANDIDATE, '算定候補', false),
];

const card = {
  card_id: 'card_1',
  card_type: CardType.PRESCRIPTION,
  patient_name: '患者 山田太郎',
  facility_name: 'ケア施設',
  room: '101',
  visit_time: '10:30',
  current_step: CurrentStep.DIFF_REVIEW,
  display_status: DisplayStatus.READY,
  assigned_user: '薬剤師A',
  server_version: 1,
  tags,
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

function renderTile(overrides: Partial<NextActionView> = {}, cardOverride: CardSummaryView = card) {
  const onOpen = vi.fn();
  const onPrimaryAction = vi.fn();
  render(
    <CardTile
      card={cardOverride}
      next_action={{ ...nextAction, ...overrides }}
      tags={cardOverride.tags}
      onOpen={onOpen}
      onPrimaryAction={onPrimaryAction}
    />,
  );
  return { onOpen, onPrimaryAction };
}

describe('CardTile', () => {
  it('opens the workspace from the card body', () => {
    const { onOpen } = renderTile();

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));

    expect(onOpen).toHaveBeenCalledWith('card_1');
  });

  it('keeps the primary action separate from opening the workspace', () => {
    const { onOpen, onPrimaryAction } = renderTile();

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する' }));

    expect(onPrimaryAction).toHaveBeenCalledWith('card_1', ActionCode.CONFIRM_PRESCRIPTION_DIFF);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('uses a primary action target of at least 44px', () => {
    renderTile();

    expect(screen.getByRole('button', { name: '処方差分を確認する' }).style.minHeight).toBe('44px');
  });

  it('does not hide safety-critical tags behind the overflow counter', () => {
    const sixSafetyTags = [
      tag(Tag.NARCOTIC, '麻薬', true),
      tag(Tag.OPIOID, 'オピオイド', true),
      tag(Tag.HIGH_RISK, 'ハイリスク', true),
      tag(Tag.COLD_CHAIN, '冷所', true),
      tag(Tag.INSULIN, 'インスリン', true),
      tag(Tag.ANTICOAGULANT, '抗凝固薬', true),
      tag(Tag.RESIDUAL, '残薬', false),
      tag(Tag.REPORT_REQUIRED, '報告必須', false),
    ];
    renderTile({}, { ...card, tags: sixSafetyTags });

    expect(screen.getByText('麻薬')).toBeTruthy();
    expect(screen.getByText('オピオイド')).toBeTruthy();
    expect(screen.getByText('ハイリスク')).toBeTruthy();
    expect(screen.getByText('冷所')).toBeTruthy();
    expect(screen.getByText('インスリン')).toBeTruthy();
    expect(screen.getByText('抗凝固薬')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('does not execute the primary action when the server marks it not enabled', () => {
    const { onPrimaryAction } = renderTile({
      enabled: false,
      ui_state: ButtonState.NO_PERMISSION,
      can_user_handle: false,
    });

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する（実行不可）' }));

    expect(onPrimaryAction).not.toHaveBeenCalled();
    expect(screen.getByText('この操作は薬剤師確認が必要です。')).toBeTruthy();
    expect(screen.getByText('次: 処方差分を確認する')).toBeTruthy();
    const primaryButton = screen.getByRole('button', { name: '処方差分を確認する（実行不可）' });
    expect(primaryButton.hasAttribute('disabled')).toBe(false);
    expect(primaryButton.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a fallback resolver for no-permission actions without a top blocker', () => {
    renderTile({
      enabled: false,
      ui_state: ButtonState.NO_PERMISSION,
      can_user_handle: false,
      required_role: [],
    });

    expect(screen.getByText('解消者: 薬剤師')).toBeTruthy();
  });

  it('shows owner and next-step context for foreign blockers', () => {
    render(
      <CardTile
        card={{
          ...card,
          blocker_summary: {
            top: {
              blocker_code: 'NEED_PHARMACIST',
              severity: BlockerSeverity.WARNING,
              owner_role: UserRole.PHARMACIST,
              message_key: 'blocker.need_pharmacist',
              active: true,
            },
            blocking_count: 1,
            total_count: 1,
          },
        }}
        next_action={{
          ...nextAction,
          enabled: false,
          ui_state: ButtonState.FOREIGN_BLOCK,
          can_user_handle: false,
        }}
        tags={card.tags}
        onOpen={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByText('薬剤師の判断が必要です。')).toBeTruthy();
    expect(screen.getByText('他の担当者による確認が必要です。')).toBeTruthy();
    expect(screen.getByText('解消者: 薬剤師')).toBeTruthy();
  });

  it('does not leak unknown blocker message keys to operators', () => {
    render(
      <CardTile
        card={{
          ...card,
          blocker_summary: {
            top: {
              blocker_code: 'UNKNOWN_BLOCKER',
              severity: BlockerSeverity.ERROR,
              owner_role: UserRole.PHARMACY_CLERK,
              message_key: 'blocker.internal_unknown',
              active: true,
            },
            blocking_count: 1,
            total_count: 1,
          },
        }}
        next_action={{
          ...nextAction,
          enabled: false,
          ui_state: ButtonState.RESOLVABLE_BLOCK,
          can_user_handle: true,
        }}
        tags={card.tags}
        onOpen={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByText('不足情報があります。')).toBeTruthy();
    expect(screen.queryByText('blocker.internal_unknown')).toBeNull();
  });

  it.each([
    [ButtonState.RESOLVABLE_BLOCK, '自分が解消できる不足があります。'],
    [ButtonState.OFFLINE_BLOCKED, '同期後に再試行してください。'],
    [ButtonState.READONLY_CLOSED, 'クローズまたはキャンセル済みです。'],
  ])('shows reason copy for %s without executing the action', (uiState, copy) => {
    const { onPrimaryAction } = renderTile({
      enabled: false,
      ui_state: uiState,
      can_user_handle: uiState === ButtonState.RESOLVABLE_BLOCK,
    });

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する（実行不可）' }));

    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.getByText('次: 処方差分を確認する')).toBeTruthy();
    expect(onPrimaryAction).not.toHaveBeenCalled();
  });

  it('prefers server disabled reason copy when provided', () => {
    renderTile({
      enabled: false,
      ui_state: ButtonState.OFFLINE_BLOCKED,
      disabled_reason_key: 'OFFLINE_NOT_ALLOWED',
    });

    expect(screen.getByText('オフライン中はこの操作を実行できません。')).toBeTruthy();
  });

  it('hides secondary comfortable-only fields in compact density', () => {
    render(
      <CardTile
        card={card}
        next_action={nextAction}
        tags={card.tags}
        density={BoardDensity.COMPACT}
        onOpen={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.queryByText('担当: 薬剤師A')).toBeNull();
  });
});
