// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourceRefKind, type ReportComposerView } from '@/phos/contracts/phos_contracts';
import { ReportComposer } from './ReportComposer';

function composer(overrides: Partial<ReportComposerView> = {}): ReportComposerView {
  return {
    card_id: 'card_1',
    patient_name: '患者 山田太郎',
    delivery_targets: [
      {
        target_id: 'doctor_1',
        target_type: 'DOCTOR',
        label: '青空クリニック',
        delivery_method: 'FAX',
        ready: true,
      },
      {
        target_id: 'family_1',
        target_type: 'FAMILY',
        label: '山田花子',
        delivery_method: 'PHONE',
        ready: false,
      },
    ],
    communication_recommendations: [
      {
        intent: 'ASK_PRESCRIBER',
        target_type: 'DOCTOR',
        rationale: '眠気と転倒リスクについて処方医へ確認します。',
        draft_seed_key: 'doctor_ask_1',
      },
    ],
    template_sections: [],
    body: '本日の要点です。',
    source_refs: [
      {
        kind: SourceRefKind.PREVIOUS_VISIT,
        ref_id: 'visit_1',
        label: '前回訪問記録',
      },
      {
        kind: SourceRefKind.EVIDENCE_FILE,
        ref_id: 'evidence_1',
        label: '残薬写真',
      },
    ],
    ...overrides,
  };
}

describe('ReportComposer', () => {
  it('renders recipient tabs, body editor, source refs, and right-side confirmation panels', () => {
    render(<ReportComposer composer={composer()} />);

    expect(screen.getByRole('heading', { name: '報告書作成' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: '宛先タブ' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '医師' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '家族' })).toBeTruthy();
    expect(screen.getAllByText('FAX').length).toBeGreaterThan(0);
    expect(screen.getByText('送付先準備済み')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '報告本文' })).toBeTruthy();
    expect(screen.getByText('薬剤師承認')).toBeTruthy();
    expect(screen.getByText('送付前に薬剤師承認が必要です')).toBeTruthy();
    expect(screen.getByText('送付先確認')).toBeTruthy();
    expect(screen.getByText('送付履歴')).toBeTruthy();
    expect(screen.getByText('送付履歴はありません')).toBeTruthy();
    expect(screen.getAllByText('前回訪問記録').length).toBeGreaterThan(0);
    expect(screen.getByText('写真・証跡')).toBeTruthy();
    expect(screen.queryByText('PREVIOUS_VISIT')).toBeNull();
    expect(screen.queryByText('evidence_1')).toBeNull();
  });

  it('appends recommendation and template sections to the report body without native disabled state', () => {
    const onBodyChange = vi.fn();
    render(<ReportComposer composer={composer()} onBodyChange={onBodyChange} />);

    fireEvent.click(screen.getByRole('button', { name: '医師確認' }));

    const body = screen.getByRole('textbox', { name: '報告本文' }) as HTMLTextAreaElement;
    expect(body.value).toContain('本日の要点です。');
    expect(body.value).toContain('医師確認');
    expect(body.value).toContain('眠気と転倒リスクについて処方医へ確認します。');
    expect(onBodyChange).toHaveBeenCalledWith(expect.stringContaining('眠気と転倒リスク'));

    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('disabled')).toBeNull();
    }
  });

  it('shows target-specific readiness and template labels when the recipient tab changes', () => {
    render(<ReportComposer composer={composer()} />);

    fireEvent.click(screen.getByRole('tab', { name: '家族' }));

    expect(screen.getByText('送付先未設定')).toBeTruthy();
    expect(screen.getAllByText('電話').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '服薬方法' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '注意症状' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '次回までの確認事項' })).toBeTruthy();
  });
});
