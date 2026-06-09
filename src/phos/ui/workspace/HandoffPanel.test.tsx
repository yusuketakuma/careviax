// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionCode, HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type { HandoffView } from '@/phos/contracts/phos_contracts';
import { HandoffPanel } from './HandoffPanel';

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
    requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    urgency: HandoffUrgency.NORMAL,
    created_by_user_id: 'user_clerk',
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    patient_name: '患者 山田太郎',
    age_minutes: 10,
    ...overrides,
  };
}

describe('HandoffPanel', () => {
  it('sorts and renders pharmacist handoff queue', () => {
    render(
      <HandoffPanel
        handoffs={[
          handoff({ handoff_id: 'normal', summary: '通常確認', urgency: HandoffUrgency.NORMAL }),
          handoff({ handoff_id: 'urgent', summary: '至急確認', urgency: HandoffUrgency.URGENT }),
        ]}
        onOpenReview={vi.fn()}
        onResolve={vi.fn()}
        onReturn={vi.fn()}
      />,
    );

    expect(
      screen
        .getAllByText(/確認/)
        .map((node) => node.textContent)
        .join(' '),
    ).toContain('至急確認');
    expect(screen.getByText('2件')).toBeTruthy();
    expect(screen.getAllByText('処方箋 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('処方原文').length).toBeGreaterThan(0);
    expect(screen.queryByText('PRESCRIPTION')).toBeNull();
    expect(screen.queryByText('rx_1')).toBeNull();
  });

  it('creates handoffs with reason, summary, urgency, and source refs', () => {
    const onCreate = vi.fn();
    render(
      <HandoffPanel
        handoffs={[handoff()]}
        createSources={[{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }]}
        onCreate={onCreate}
        onOpenReview={vi.fn()}
        onResolve={vi.fn()}
        onReturn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '確認依頼を作成' }));
    fireEvent.change(screen.getByLabelText('理由コード'), { target: { value: 'DIFF_REVIEW' } });
    fireEvent.change(screen.getByLabelText('確認内容'), {
      target: { value: '処方差分を確認してください。' },
    });
    fireEvent.change(screen.getByLabelText('緊急度'), { target: { value: HandoffUrgency.HIGH } });
    fireEvent.click(screen.getByRole('button', { name: '作成する' }));

    expect(onCreate).toHaveBeenCalledWith({
      reason_code: 'DIFF_REVIEW',
      summary: '処方差分を確認してください。',
      urgency: HandoffUrgency.HIGH,
    });
  });

  it('opens review for OPEN handoffs through a configured callback', () => {
    const onOpenReview = vi.fn();
    render(
      <HandoffPanel
        handoffs={[handoff()]}
        onOpenReview={onOpenReview}
        onResolve={vi.fn()}
        onReturn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '確認を開始' }));

    expect(onOpenReview).toHaveBeenCalledWith('handoff_1');
  });

  it('resolves IN_REVIEW handoffs through the requested action', () => {
    const onResolve = vi.fn();
    render(
      <HandoffPanel
        handoffs={[handoff({ status: HandoffStatus.IN_REVIEW })]}
        onOpenReview={vi.fn()}
        onResolve={onResolve}
        onReturn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '確認依頼を解決する' }));

    expect(onResolve).toHaveBeenCalledWith('handoff_1', ActionCode.CONFIRM_PRESCRIPTION_DIFF);
  });

  it('requires return reason and note before returning to clerk queue', () => {
    const onReturn = vi.fn();
    render(
      <HandoffPanel
        handoffs={[handoff({ status: HandoffStatus.IN_REVIEW })]}
        onOpenReview={vi.fn()}
        onResolve={vi.fn()}
        onReturn={onReturn}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '事務へ戻す' }));
    fireEvent.click(screen.getByRole('button', { name: '差し戻す' }));

    expect(screen.getByText('差し戻し理由とメモを入力してください。')).toBeTruthy();
    expect(onReturn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('差し戻し理由コード'), {
      target: { value: 'NEED_MORE_INFO' },
    });
    fireEvent.change(screen.getByLabelText('差し戻しメモ'), {
      target: { value: '施設連絡先を確認してください。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '差し戻す' }));

    expect(onReturn).toHaveBeenCalledWith(
      'handoff_1',
      'NEED_MORE_INFO',
      '施設連絡先を確認してください。',
    );
  });
});
