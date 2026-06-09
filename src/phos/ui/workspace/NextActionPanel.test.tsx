// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ActionPhase,
  ButtonState,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { BlockerView, NextActionView } from '@/phos/contracts/phos_contracts';
import { NextActionPanel } from './NextActionPanel';

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

const blocker = {
  blocker_code: 'MISSING_EVIDENCE',
  severity: 'ERROR',
  owner_role: UserRole.PHARMACIST,
  message_key: 'blocker.missing_evidence',
  active: true,
} satisfies BlockerView;

describe('NextActionPanel', () => {
  it('executes only server-enabled next actions', () => {
    const onExecute = vi.fn();
    render(
      <NextActionPanel
        cardId="card_1"
        nextAction={nextAction}
        blockers={[]}
        onExecute={onExecute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する' }));

    expect(onExecute).toHaveBeenCalledWith(
      'card_1',
      ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      undefined,
    );
  });

  it('requires reason_code before executing reason-required actions', () => {
    const onExecute = vi.fn();
    render(
      <NextActionPanel
        cardId="card_1"
        nextAction={{
          ...nextAction,
          code: ActionCode.REJECT_SET_AUDIT,
          label_key: 'action.reject_set_audit',
          reason_required: true,
        }}
        blockers={[]}
        onExecute={onExecute}
      />,
    );

    const blockedButton = screen.getByRole('button', { name: 'セット監査を差し戻す（実行不可）' });
    expect(blockedButton.getAttribute('disabled')).toBeNull();
    expect(blockedButton.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(blockedButton);
    expect(onExecute).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('理由'), { target: { value: 'PHOTO_INSUFFICIENT' } });
    fireEvent.change(screen.getByLabelText('補足'), { target: { value: ' 写真が不鮮明です。 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'セット監査を差し戻す' }));

    expect(onExecute).toHaveBeenCalledWith('card_1', ActionCode.REJECT_SET_AUDIT, {
      reason_code: 'PHOTO_INSUFFICIENT',
      reason_note: '写真が不鮮明です。',
    });
  });

  it('does not execute server-unavailable actions', () => {
    const onExecute = vi.fn();
    render(
      <NextActionPanel
        cardId="card_1"
        nextAction={{ ...nextAction, enabled: false }}
        blockers={[blocker]}
        actionMessage="必要な情報が不足しています。"
        onExecute={onExecute}
      />,
    );

    const unavailableButton = screen.getByRole('button', {
      name: '処方差分を確認する（実行不可）',
    });
    fireEvent.click(unavailableButton);

    expect(screen.getByText('必要な情報が不足しています。')).toBeTruthy();
    expect(screen.getByText('1件の確認が必要です。')).toBeTruthy();
    expect(unavailableButton.getAttribute('disabled')).toBeNull();
    expect(unavailableButton.getAttribute('aria-disabled')).toBe('true');
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before executing SEND_REPORT', () => {
    const onExecute = vi.fn();
    render(
      <NextActionPanel
        cardId="card_1"
        nextAction={{
          ...nextAction,
          code: ActionCode.SEND_REPORT,
          label_key: 'action.send_report',
        }}
        blockers={[blocker]}
        reportConfirmation={{
          patientName: '患者 山田太郎',
          targetLabel: '山田医師',
          deliveryMethod: 'FAX',
          summary: '眠気について共有',
          evidenceCount: 2,
        }}
        onExecute={onExecute}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '報告書を送付する' }));

    expect(onExecute).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: '送付前確認' })).toBeTruthy();
    expect(screen.getByText('患者 山田太郎')).toBeTruthy();
    expect(screen.getByText('山田医師')).toBeTruthy();
    expect(screen.getByText('FAX')).toBeTruthy();
    expect(screen.getByText('眠気について共有')).toBeTruthy();
    expect(screen.getByText('1件')).toBeTruthy();
    expect(screen.getByText('2件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '送付する' }));

    expect(onExecute).toHaveBeenCalledWith('card_1', ActionCode.SEND_REPORT, undefined);
  });

  it('locks execution while the action is submitting', () => {
    const onExecute = vi.fn();
    render(
      <NextActionPanel
        cardId="card_1"
        nextAction={nextAction}
        blockers={[]}
        actionPhase={ActionPhase.SUBMITTING}
        onExecute={onExecute}
      />,
    );

    const submittingButton = screen.getByRole('button', { name: '処方差分を確認する（送信中）' });
    fireEvent.click(submittingButton);

    expect(screen.getByText('操作状態: SUBMITTING')).toBeTruthy();
    expect(submittingButton.getAttribute('disabled')).toBeNull();
    expect(submittingButton.getAttribute('aria-disabled')).toBe('true');
    expect(onExecute).not.toHaveBeenCalled();
  });
});
