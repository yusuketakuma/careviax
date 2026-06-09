// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReportDeliveryStatus, type ReportDeliveryView } from '@/phos/contracts/phos_contracts';
import { ReportDeliveryQueue } from './ReportDeliveryQueue';

function delivery(overrides: Partial<ReportDeliveryView> = {}): ReportDeliveryView {
  return {
    delivery_id: 'delivery_1',
    card_id: 'card_1',
    report_id: 'report_1',
    patient_name: '患者 山田太郎',
    target_label: '山田医師',
    status: ReportDeliveryStatus.WAITING_REPLY,
    delivery_method: 'FAX',
    sent_at: '2026-06-09T00:00:00.000Z',
    stale_minutes: 90,
    server_version: 1,
    source_refs: [{ kind: 'EVIDENCE_FILE', ref_id: 'report_1', label: '報告書' }],
    ...overrides,
  };
}

describe('ReportDeliveryQueue', () => {
  it('renders waiting replies sorted by stale minutes with source refs visible', () => {
    render(
      <ReportDeliveryQueue
        deliveries={[
          delivery({ delivery_id: 'fresh', stale_minutes: 5, target_label: '新しい宛先' }),
          delivery({ delivery_id: 'stale', stale_minutes: 120, target_label: '古い宛先' }),
        ]}
        onOpenCard={vi.fn()}
      />,
    );

    expect(screen.getByText('2件')).toBeTruthy();
    const targets = screen.getAllByText(/宛先$/).map((node) => node.textContent);
    expect(targets[0]).toBe('古い宛先');
    expect(screen.getAllByText('報告書').length).toBeGreaterThan(0);
    expect(screen.getAllByText('写真・証跡').length).toBeGreaterThan(0);
    expect(screen.queryByText('EVIDENCE_FILE')).toBeNull();
    expect(screen.queryByText('report_1')).toBeNull();
  });

  it('opens the related card without mutating delivery status in the browser', () => {
    const onOpenCard = vi.fn();
    render(<ReportDeliveryQueue deliveries={[delivery()]} onOpenCard={onOpenCard} />);

    fireEvent.click(screen.getByRole('button', { name: 'カードを開く' }));

    expect(onOpenCard).toHaveBeenCalledWith('card_1');
  });

  it('registers a reply only after required fields are filled', () => {
    const onRegisterReply = vi.fn();
    render(
      <ReportDeliveryQueue
        deliveries={[delivery()]}
        onOpenCard={vi.fn()}
        onRegisterReply={onRegisterReply}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '返信を登録' }));
    expect(onRegisterReply).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('患者 山田太郎の返信内容'), {
      target: { value: '問題ありません。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信を登録' }));

    expect(onRegisterReply).toHaveBeenCalledWith(
      expect.objectContaining({ delivery_id: 'delivery_1' }),
      {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
      },
    );
  });

  it('requires an action note when reply result is action required', () => {
    const onRegisterReply = vi.fn();
    render(
      <ReportDeliveryQueue
        deliveries={[delivery()]}
        onOpenCard={vi.fn()}
        onRegisterReply={onRegisterReply}
      />,
    );

    fireEvent.change(screen.getByLabelText('患者 山田太郎の返信結果'), {
      target: { value: ReportDeliveryStatus.ACTION_REQUIRED },
    });
    fireEvent.change(screen.getByLabelText('患者 山田太郎の返信内容'), {
      target: { value: '追加対応が必要です。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信を登録' }));
    expect(onRegisterReply).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('患者 山田太郎の必要な対応'), {
      target: { value: '薬剤師が電話確認する。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信を登録' }));

    expect(onRegisterReply).toHaveBeenCalledWith(expect.any(Object), {
      result_status: ReportDeliveryStatus.ACTION_REQUIRED,
      reply_summary: '追加対応が必要です。',
      action_required_note: '薬剤師が電話確認する。',
    });
  });

  it('marks action-required replies done without using a disabled attribute', () => {
    const onMarkActionDone = vi.fn();
    render(
      <ReportDeliveryQueue
        deliveries={[
          delivery({
            status: ReportDeliveryStatus.ACTION_REQUIRED,
            action_required_note: '薬剤師確認が必要です。',
          }),
        ]}
        onOpenCard={vi.fn()}
        onMarkActionDone={onMarkActionDone}
      />,
    );

    const button = screen.getByRole('button', { name: '返信対応を完了' });
    expect(button.getAttribute('disabled')).toBeNull();
    expect(button.getAttribute('data-enabled')).toBe('false');
    fireEvent.click(button);
    expect(onMarkActionDone).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('患者 山田太郎の対応内容'), {
      target: { value: '電話で確認済み。' },
    });
    expect(button.getAttribute('data-enabled')).toBe('true');
    fireEvent.click(button);

    expect(onMarkActionDone).toHaveBeenCalledWith(expect.any(Object), {
      action_note: '電話で確認済み。',
    });
  });

  it('renders an empty state for no waiting replies', () => {
    render(<ReportDeliveryQueue deliveries={[]} onOpenCard={vi.fn()} />);

    expect(screen.getByText('返信待ちの報告書はありません。')).toBeTruthy();
  });
});
