// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  Tag,
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
  });
});
