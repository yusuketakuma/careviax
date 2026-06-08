// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  BlockerSeverity,
  HandoffStatus,
  HandoffUrgency,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { CardDetailResponse } from '@/phos/contracts/phos_contracts';
import { WorkspaceOverlay } from './WorkspaceOverlay';

function detail(): CardDetailResponse {
  return {
    card: {
      card_id: 'card_1',
      card_type: CardType.PRESCRIPTION,
      patient_name: '患者 山田太郎',
      current_step: CurrentStep.DIFF_REVIEW,
      display_status: DisplayStatus.READY,
      server_version: 1,
      tags: [],
    },
    visible_tabs: ['OVERVIEW', 'PRESCRIPTION'],
    permissions: {
      can_read: true,
      can_write: true,
      allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    },
    next_action: {
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
    },
    blockers: [
      {
        blocker_code: 'MISSING_EVIDENCE',
        severity: BlockerSeverity.ERROR,
        owner_role: UserRole.PHARMACY_CLERK,
        message_key: 'blocker.missing_evidence',
        required_action_code: ActionCode.UPLOAD_EVIDENCE,
        active: true,
      },
    ],
    handoffs: [
      {
        handoff_id: 'handoff_1',
        card_id: 'card_1',
        status: HandoffStatus.OPEN,
        reason_code: 'DIFF_REVIEW',
        summary: '薬剤師確認が必要です。',
        source_refs: [],
        requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        urgency: HandoffUrgency.HIGH,
        created_by_user_id: 'user_clerk',
        created_at: '2026-06-09T00:00:00.000Z',
        updated_at: '2026-06-09T00:00:00.000Z',
        server_version: 1,
        patient_name: '患者 山田太郎',
        age_minutes: 15,
      },
    ],
    source_refs: [
      {
        kind: 'PRESCRIPTION',
        ref_id: 'rx_1',
        label: '処方箋 1',
      },
    ],
    server_version: 1,
  };
}

describe('WorkspaceOverlay', () => {
  it('renders only server-provided visible tabs', () => {
    render(
      <WorkspaceOverlay
        detail={detail()}
        open
        onOpenChange={vi.fn()}
        onExecute={vi.fn()}
        onOpenHandoffReview={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: '概要' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '処方' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '算定' })).toBeNull();
  });

  it('renders blocker details in the right pane', () => {
    render(
      <WorkspaceOverlay
        detail={detail()}
        open
        onOpenChange={vi.fn()}
        onExecute={vi.fn()}
        onOpenHandoffReview={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '不足・確認事項' })).toBeTruthy();
    expect(screen.getByText('証跡が不足しています。')).toBeTruthy();
    expect(screen.getByText('必要操作: 証跡を添付する')).toBeTruthy();
  });

  it('renders a source drawer trigger in the right pane', () => {
    render(
      <WorkspaceOverlay
        detail={detail()}
        open
        onOpenChange={vi.fn()}
        onExecute={vi.fn()}
        onOpenHandoffReview={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '参照情報を開く' }));

    expect(screen.getAllByText('処方箋 1').length).toBeGreaterThan(0);
  });

  it('renders handoff queue controls in the right pane', () => {
    const onCreateHandoff = vi.fn();
    render(
      <WorkspaceOverlay
        detail={detail()}
        open
        onOpenChange={vi.fn()}
        onExecute={vi.fn()}
        onOpenHandoffReview={vi.fn()}
        onCreateHandoff={onCreateHandoff}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '確認依頼を作成' }));
    fireEvent.change(screen.getByLabelText('理由コード'), { target: { value: 'DIFF_REVIEW' } });
    fireEvent.change(screen.getByLabelText('確認内容'), {
      target: { value: '処方差分を確認してください。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成する' }));

    expect(screen.getByRole('heading', { name: '薬剤師確認依頼' })).toBeTruthy();
    expect(onCreateHandoff).toHaveBeenCalledWith('card_1', {
      reason_code: 'DIFF_REVIEW',
      summary: '処方差分を確認してください。',
      urgency: HandoffUrgency.NORMAL,
    });
  });

  it('renders detail errors inside the overlay instead of closing the board surface', () => {
    render(
      <WorkspaceOverlay
        detail={null}
        detailError="カード詳細を読み込めません。"
        open
        onOpenChange={vi.fn()}
        onExecute={vi.fn()}
        onOpenHandoffReview={vi.fn()}
      />,
    );

    expect(screen.getByText('カード詳細を読み込めません。')).toBeTruthy();
  });

  it('delegates close through the focus-trapping dialog primitive', () => {
    const onOpenChange = vi.fn();
    render(
      <WorkspaceOverlay
        detail={detail()}
        open
        onOpenChange={onOpenChange}
        onExecute={vi.fn()}
        onOpenHandoffReview={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });

  it('closes on Escape when there is no unsaved input', () => {
    const onOpenChange = vi.fn();
    render(
      <WorkspaceOverlay
        detail={detail()}
        open
        onOpenChange={onOpenChange}
        onExecute={vi.fn()}
        onOpenHandoffReview={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onOpenChange).toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });
});
