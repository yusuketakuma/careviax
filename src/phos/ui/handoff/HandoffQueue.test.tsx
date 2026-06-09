// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionCode, HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type { HandoffView } from '@/phos/contracts/phos_contracts';
import { HandoffQueue } from './HandoffQueue';

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
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

describe('HandoffQueue', () => {
  it('renders OPEN handoffs sorted by urgency and age with source refs visible', () => {
    render(
      <HandoffQueue
        handoffs={[
          handoff({ handoff_id: 'normal', summary: '通常確認', urgency: HandoffUrgency.NORMAL }),
          handoff({
            handoff_id: 'urgent',
            card_id: 'card_urgent',
            summary: '至急確認',
            urgency: HandoffUrgency.URGENT,
            age_minutes: 5,
          }),
          handoff({ handoff_id: 'resolved', status: HandoffStatus.RESOLVED }),
        ]}
        onOpenCard={vi.fn()}
        onOpenReview={vi.fn()}
        onResolve={vi.fn()}
        onReturn={vi.fn()}
      />,
    );

    expect(screen.getByText('2件')).toBeTruthy();
    expect(screen.queryByText('解決済み')).toBeNull();
    const summaries = screen.getAllByText(/確認$/).map((node) => node.textContent);
    expect(summaries[0]).toBe('至急確認');
    expect(screen.getAllByText('処方箋 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('処方原文').length).toBeGreaterThan(0);
    expect(screen.queryByText('PRESCRIPTION')).toBeNull();
    expect(screen.queryByText('rx_1')).toBeNull();
  });

  it('opens the source card instead of mutating handoff status in the browser', () => {
    const onOpenCard = vi.fn();
    render(
      <HandoffQueue
        handoffs={[handoff()]}
        onOpenCard={onOpenCard}
        onOpenReview={vi.fn()}
        onResolve={vi.fn()}
        onReturn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'カードを開く' }));

    expect(onOpenCard).toHaveBeenCalledWith('card_1');
  });

  it('opens pharmacist review through the lifecycle API callback', () => {
    const onOpenReview = vi.fn();
    render(
      <HandoffQueue
        handoffs={[handoff()]}
        onOpenCard={vi.fn()}
        onOpenReview={onOpenReview}
        onResolve={vi.fn()}
        onReturn={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '確認を開始' }));

    expect(onOpenReview).toHaveBeenCalledWith('handoff_1');
  });

  it('keeps IN_REVIEW handoffs in the pharmacist queue and resolves requested actions', () => {
    const onResolve = vi.fn();
    render(
      <HandoffQueue
        handoffs={[
          handoff({
            status: HandoffStatus.IN_REVIEW,
            requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          }),
        ]}
        onOpenCard={vi.fn()}
        onOpenReview={vi.fn()}
        onResolve={onResolve}
        onReturn={vi.fn()}
      />,
    );

    expect(screen.getByText(/確認中/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '確認依頼を解決する' }));

    expect(onResolve).toHaveBeenCalledWith('handoff_1', ActionCode.CONFIRM_PRESCRIPTION_DIFF);
  });

  it('returns IN_REVIEW handoffs with structured reason copy and note', () => {
    const onReturn = vi.fn();
    render(
      <HandoffQueue
        handoffs={[handoff({ status: HandoffStatus.IN_REVIEW })]}
        onOpenCard={vi.fn()}
        onOpenReview={vi.fn()}
        onResolve={vi.fn()}
        onReturn={onReturn}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '事務へ戻す' }));
    fireEvent.click(screen.getByRole('button', { name: '差し戻す' }));

    expect(screen.getByText('差し戻し理由とメモを入力してください。')).toBeTruthy();
    expect(onReturn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('差し戻し理由'), {
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
    expect(screen.getByText('情報の追加が必要です')).toBeTruthy();
    expect(screen.queryByText('NEED_MORE_INFO')).toBeNull();
  });

  it('returns IN_REVIEW handoffs with Cmd/Ctrl+Enter after the note is filled', () => {
    const onReturn = vi.fn();
    render(
      <HandoffQueue
        handoffs={[handoff({ status: HandoffStatus.IN_REVIEW })]}
        onOpenCard={vi.fn()}
        onOpenReview={vi.fn()}
        onResolve={vi.fn()}
        onReturn={onReturn}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '事務へ戻す' }));
    const note = screen.getByLabelText('差し戻しメモ');
    fireEvent.keyDown(note, { key: 'Enter', metaKey: true });
    expect(onReturn).not.toHaveBeenCalled();
    expect(screen.getByText('差し戻し理由とメモを入力してください。')).toBeTruthy();

    fireEvent.change(note, { target: { value: ' 施設連絡先を確認してください。 ' } });
    fireEvent.keyDown(note, { key: 'Enter', metaKey: true });

    expect(onReturn).toHaveBeenCalledWith(
      'handoff_1',
      'NEED_MORE_INFO',
      '施設連絡先を確認してください。',
    );
  });
});
