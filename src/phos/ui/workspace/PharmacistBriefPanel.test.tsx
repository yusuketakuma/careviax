// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionCode, BlockerSeverity, ClaimCandidateStatus } from '@/phos/contracts/phos_contracts';
import type { PharmacistBrief } from '@/phos/contracts/phos_contracts';
import { PharmacistBriefPanel } from './PharmacistBriefPanel';

function brief(): PharmacistBrief {
  return {
    clinical_signals: [
      {
        code: 'DOSE_INCREASE',
        severity: BlockerSeverity.WARNING,
        title: 'A錠 5mg から 10mg へ増量',
        detail: '前回ふらつきあり。今回訪問で眠気と転倒リスクを確認します。',
        recommended_action_code: ActionCode.CREATE_REPORT_DRAFT,
        source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '今回処方' }],
      },
    ],
    decisions_required: [
      {
        decision_id: 'decision_1',
        reason_code: 'RESIDUAL_ADJUSTMENT',
        title: '残薬調整候補があります',
        why: '残薬が多く、次回処方提案の判断が必要です。',
        source_refs: [{ kind: 'PREVIOUS_VISIT', ref_id: 'visit_1', label: '前回訪問記録' }],
        options: [
          { code: 'NO_ISSUE', label: '問題なし', requires_note: false },
          {
            code: 'ASK_PRESCRIBER',
            label: '処方医へ確認',
            requires_note: true,
            emits_action_code: ActionCode.CREATE_REPORT_DRAFT,
          },
        ],
      },
    ],
    communication_recommendations: [
      {
        intent: 'ASK_PRESCRIBER',
        target_type: 'DOCTOR',
        rationale: '増量後の眠気確認を共有します。',
        draft_seed_key: 'seed_1',
      },
    ],
    claim_warnings: [
      {
        fee_code: 'HOME_VISIT_MEDICATION_GUIDANCE',
        status: ClaimCandidateStatus.MISSING_EVIDENCE,
        status_label: '証跡不足',
        missing_evidence_keys: ['emergency_contact', 'visit_photo'],
        next_action_code: ActionCode.UPLOAD_EVIDENCE,
      },
    ],
    source_refs: [{ kind: 'RULE_DOCUMENT', ref_id: 'rule_1', label: '2026改定資料' }],
  };
}

describe('PharmacistBriefPanel', () => {
  it('renders pharmacist brief sections in decision-first order without raw enum display', () => {
    render(<PharmacistBriefPanel cardId="card_1" brief={brief()} />);

    const headings = screen
      .getAllByRole('heading')
      .map((heading) => heading.textContent)
      .filter(Boolean);
    expect(headings).toEqual([
      '薬剤師判断',
      '判断してください',
      '臨床シグナル',
      '発信候補',
      '算定・証跡警告',
      '根拠',
    ]);
    expect(screen.getAllByText('残薬調整候補があります').length).toBeGreaterThan(0);
    expect(screen.getByText('残薬調整')).toBeTruthy();
    expect(screen.getByText('増量')).toBeTruthy();
    expect(screen.getByText('医師確認')).toBeTruthy();
    expect(screen.getByText('宛先: 医師')).toBeTruthy();
    expect(screen.getByText('不足証跡: 2件')).toBeTruthy();
    expect(screen.getAllByText('処方原文').length).toBeGreaterThan(0);
    expect(screen.getAllByText('前回訪問記録').length).toBeGreaterThan(0);
    expect(screen.getAllByText('算定・制度資料').length).toBeGreaterThan(0);
    expect(screen.queryByText('DOSE_INCREASE')).toBeNull();
    expect(screen.queryByText('RESIDUAL_ADJUSTMENT')).toBeNull();
    expect(screen.queryByText('ASK_PRESCRIBER')).toBeNull();
    expect(screen.queryByText('DOCTOR')).toBeNull();
    expect(screen.queryByText('MISSING_EVIDENCE')).toBeNull();
    expect(screen.queryByText('rx_1')).toBeNull();
    expect(screen.queryByText('visit_1')).toBeNull();
    expect(screen.queryByText('rule_1')).toBeNull();
  });

  it('requires notes for note-required decision options and delegates emitting actions', () => {
    const onExecute = vi.fn();
    render(<PharmacistBriefPanel cardId="card_1" brief={brief()} onExecute={onExecute} />);

    const option = screen.getByRole('button', { name: /処方医へ確認/ });
    expect(option.getAttribute('data-enabled')).toBe('false');
    expect(option.hasAttribute('disabled')).toBe(false);
    fireEvent.click(option);
    expect(onExecute).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('補足'), {
      target: { value: '眠気と転倒リスクを医師へ確認します。' },
    });
    expect(option.getAttribute('data-enabled')).toBe('true');
    fireEvent.click(option);
    expect(onExecute).toHaveBeenCalledWith('card_1', ActionCode.CREATE_REPORT_DRAFT);
  });

  it('delegates non-emitting decision selections without inventing a card transition', () => {
    const onSelectDecision = vi.fn();
    const onExecute = vi.fn();
    render(
      <PharmacistBriefPanel
        cardId="card_1"
        brief={brief()}
        onExecute={onExecute}
        onSelectDecision={onSelectDecision}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /問題なし/ }));

    expect(onExecute).not.toHaveBeenCalled();
    expect(onSelectDecision).toHaveBeenCalledWith('card_1', 'decision_1', 'NO_ISSUE', undefined);
  });

  it('renders an empty pharmacist brief state inside the panel', () => {
    render(<PharmacistBriefPanel cardId="card_1" />);

    const panel = screen.getByRole('heading', { name: '薬剤師判断' }).closest('aside');
    expect(panel).toBeTruthy();
    expect(
      within(panel as HTMLElement).getByText('薬剤師判断に必要な追加情報はありません。'),
    ).toBeTruthy();
  });
});
