// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type { HandoffView } from '@/phos/contracts/phos_contracts';
import { ClerkSupportWorkbench } from './ClerkSupportWorkbench';

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.RETURNED,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
    urgency: HandoffUrgency.NORMAL,
    created_by_user_id: 'user_clerk',
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 2,
    patient_name: '患者 山田太郎',
    age_minutes: 10,
    return_reason_code: 'NEED_MORE_INFO',
    return_note: '施設連絡先を確認してください。',
    ...overrides,
  };
}

describe('ClerkSupportWorkbench', () => {
  it('renders RETURNED handoffs and hides resolved handoffs', () => {
    render(
      <ClerkSupportWorkbench
        handoffs={[handoff(), handoff({ handoff_id: 'resolved', status: HandoffStatus.RESOLVED })]}
        onOpenCard={vi.fn()}
      />,
    );

    expect(screen.getByText('1件')).toBeTruthy();
    expect(screen.getByText('情報の追加が必要です')).toBeTruthy();
    expect(screen.getByText('追加すること: 施設連絡先を確認してください。')).toBeTruthy();
    expect(screen.queryByText('NEED_MORE_INFO')).toBeNull();
  });

  it('opens the returned handoff card', () => {
    const onOpenCard = vi.fn();
    render(<ClerkSupportWorkbench handoffs={[handoff()]} onOpenCard={onOpenCard} />);

    fireEvent.click(screen.getByRole('button', { name: 'カードを開く' }));

    expect(onOpenCard).toHaveBeenCalledWith('card_1');
  });
});
