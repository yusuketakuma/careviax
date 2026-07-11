// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PhysicianReportContent } from '@/types/care-report-content';
import {
  AI_DRAFT_AUDIENCES,
  buildAiDraftSections,
  ReportAiDraftReview,
} from './report-ai-draft-review';

const PHYSICIAN_CONTENT = {
  patient: { name: '田中 一郎', birth_date: '1949-05-01', gender: 'male' },
  report_date: '2026-06-12',
  visit_date: '2026-06-12',
  pharmacist_name: '山田 太郎',
  prescriber: { name: '山本 先生', institution: '山本クリニック' },
  prescriptions: [],
  medication_management: {
    compliance_summary: '夕食後の薬は家族声かけで服用できています。',
    adherence_score: 4,
    self_management: '一部介助',
    calendar_used: true,
  },
  adverse_events: { has_events: false, events: [] },
  functional_assessment: {
    sleep: '良好',
    cognition: '変化なし',
    diet_oral: '普通',
    mobility: '伝い歩き',
    excretion: '便秘気味',
  },
  residual_medications: [
    { drug_name: 'アムロジピン錠5mg', remaining_qty: 6, excess_days: 3, reduction_proposal: true },
  ],
  assessment: '服薬は安定。便秘傾向への対応が必要。',
  plan: '酸化マグネシウムの用量調整を検討。',
  prescription_proposals: '',
  physician_communication: '便秘症状について次回診察での評価をお願いします。',
  warnings: [],
} satisfies PhysicianReportContent;

describe('buildAiDraftSections', () => {
  it('projects physician content onto the five p1_04 headings', () => {
    const sections = buildAiDraftSections(PHYSICIAN_CONTENT);

    expect(sections.map((section) => section.title)).toEqual([
      '今日の要点',
      '服薬状況',
      '残薬',
      '薬剤師の評価',
      'お願いしたいこと',
    ]);
    expect(sections[0].body).toContain('服薬は安定');
    expect(sections[1].body).toContain('家族声かけ');
    expect(sections[2].body).toContain('アムロジピン錠5mg 残6(超過3日)');
    expect(sections[3].body).toContain('用量調整');
    expect(sections[4].body).toContain('次回診察');
  });

  it('falls back to a placeholder when content is missing', () => {
    const sections = buildAiDraftSections(null);
    expect(sections).toHaveLength(5);
    expect(new Set(sections.map((section) => section.body)).size).toBe(1);
    expect(sections[0].body).toContain('未入力');
  });
});

describe('ReportAiDraftReview', () => {
  it('fails closed when structured content is unavailable', () => {
    const onConfirm = vi.fn();
    render(
      createElement(ReportAiDraftReview, {
        content: null,
        reportType: 'physician_report',
        confirmPending: false,
        onConfirm,
      }),
    );

    expect(screen.getByText('下書き本文を確認できません')).toBeTruthy();
    const confirmButton = screen.getByRole('button', { name: '薬剤師確認済みにする' });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    expect(confirmButton.getAttribute('aria-describedby')).toBe('ai-draft-confirm-disabled-reason');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('includes the supported family audience in the canonical preview list', () => {
    expect(AI_DRAFT_AUDIENCES).toContainEqual({ key: 'family_share', label: '家族向け' });
  });
});
