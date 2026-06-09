// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SupportBrief } from '@/phos/contracts/phos_contracts';
import { SupportBriefPanel } from './SupportBriefPanel';

function brief(): SupportBrief {
  return {
    support_tasks: [
      {
        task_code: 'CONTACT_SETUP',
        label: '施設連絡先を確認する',
        enabled: true,
      },
      {
        task_code: 'REPORT_PREP',
        label: '送付前確認を待つ',
        enabled: false,
      },
    ],
    missing_contacts: [
      {
        contact_id: 'contact_1',
        target_type: 'FACILITY',
        label: '施設代表電話',
        required_field_keys: ['phone'],
      },
    ],
    delivery_targets: [
      {
        target_id: 'target_1',
        target_type: 'DOCTOR',
        label: '山田医師',
        delivery_method: 'FAX',
        ready: false,
      },
    ],
    schedule_candidates: [
      {
        candidate_id: 'schedule_1',
        date: '2026-06-10',
        start_time: '10:00',
        end_time: '10:30',
        label: '午前訪問候補',
      },
    ],
    missing_evidences: [
      {
        evidence_key: 'photo_1',
        label: '残薬写真',
        required: true,
      },
    ],
    waiting_replies: [
      {
        delivery_id: 'delivery_1',
        target_label: '山田医師',
        sent_at: '2026-06-09T00:00:00.000Z',
        stale_minutes: 90,
      },
    ],
    pharmacist_review_reasons: [
      {
        reason_code: 'DIFF_REVIEW',
        label: '処方差分の確認が必要です',
        source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
      },
    ],
  };
}

describe('SupportBriefPanel', () => {
  it('renders clerk support sections from SupportBrief without raw enum display', () => {
    render(<SupportBriefPanel brief={brief()} />);

    expect(screen.getByRole('heading', { name: '事務サポート' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '事務でできること' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '不足連絡先' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '送付先準備' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '訪問候補時間' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '不足証跡' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '返信待ち' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '薬剤師確認が必要なこと' })).toBeTruthy();
    expect(screen.getByText('施設連絡先を確認する')).toBeTruthy();
    expect(screen.getByText('対応できます')).toBeTruthy();
    expect(screen.getByText('確認が必要です')).toBeTruthy();
    expect(screen.getByText('宛先: 施設')).toBeTruthy();
    expect(screen.getByText('不足項目: 1件')).toBeTruthy();
    expect(screen.getByText(/方法: FAX/)).toBeTruthy();
    expect(screen.getByText('未準備')).toBeTruthy();
    expect(screen.getByText('候補: 2026-06-10 10:00-10:30')).toBeTruthy();
    expect(screen.getByText('残薬写真')).toBeTruthy();
    expect(screen.getByText('必須')).toBeTruthy();
    expect(screen.getByText('90分経過')).toBeTruthy();
    expect(screen.getByText('処方差分')).toBeTruthy();
    expect(screen.getAllByText('処方原文').length).toBeGreaterThan(0);
    expect(screen.queryByText('CONTACT_SETUP')).toBeNull();
    expect(screen.queryByText('DIFF_REVIEW')).toBeNull();
    expect(screen.queryByText('PRESCRIPTION')).toBeNull();
    expect(screen.queryByText('rx_1')).toBeNull();
    expect(screen.queryByText('phone')).toBeNull();
  });

  it('renders an empty SupportBrief state when the server returns no support work', () => {
    render(
      <SupportBriefPanel
        brief={{
          support_tasks: [],
          missing_contacts: [],
          delivery_targets: [],
          schedule_candidates: [],
          missing_evidences: [],
          waiting_replies: [],
          pharmacist_review_reasons: [],
        }}
      />,
    );

    expect(screen.getByText('いま事務で処理できる作業はありません。')).toBeTruthy();
  });

  it('does not render when SupportBrief is absent from card detail', () => {
    const { container } = render(<SupportBriefPanel />);

    expect(container.textContent).toBe('');
  });
});
