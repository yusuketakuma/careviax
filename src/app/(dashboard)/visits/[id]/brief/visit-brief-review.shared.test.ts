import { describe, expect, it } from 'vitest';
import type { VisitBriefAiSummary, VisitBriefRuleSummary } from '@/types/visit-brief';
import {
  buildNeedsEditFeedbackInput,
  composeBriefParagraph,
  CORRECTED_SUMMARY_MAX_LENGTH,
  formatBriefGeneratedAt,
  mapConfirmChoiceToFeedback,
  PHARMACIST_CONFIRM_CHOICES,
  pickVisitPatientId,
  resolveEvidenceLinks,
  selectBriefSummary,
  validateCorrectedSummary,
} from './visit-brief-review.shared';

function buildAiSummary(overrides: Partial<VisitBriefAiSummary> = {}): VisitBriefAiSummary {
  return {
    generation_id: 'gen_ai_1',
    provider: 'openai',
    requested_provider: 'openai',
    is_fallback: false,
    model: 'gpt-test',
    fallback_reason: null,
    headline: '前回から利尿薬が追加されています',
    bullets: ['ふらつき・脱水・食事量の変化を確認してください'],
    must_check_today: [],
    source_refs: ['処方変更'],
    generated_at: '2026-06-13T08:30:00.000Z',
    duration_ms: 1200,
    recent_generation_count_24h: 1,
    recent_failure_count_24h: 0,
    recent_failure_rate_24h: 0,
    ...overrides,
  };
}

function buildRuleSummary(overrides: Partial<VisitBriefRuleSummary> = {}): VisitBriefRuleSummary {
  return {
    generation_id: 'gen_rule_1',
    headline: 'ルール要約の見出し',
    bullets: ['ルール由来の確認事項'],
    must_check_today: [],
    source_refs: ['rule'],
    generated_at: '2026-06-13T08:00:00.000Z',
    ...overrides,
  };
}

describe('selectBriefSummary', () => {
  it('AI 生成が有効なら AI 要約を選ぶ', () => {
    const selection = selectBriefSummary({
      ai_summary: buildAiSummary(),
      rule_summary: buildRuleSummary(),
    });
    expect(selection.kind).toBe('ai');
    expect(selection.generationId).toBe('gen_ai_1');
    expect(selection.headline).toBe('前回から利尿薬が追加されています');
  });

  it('AI 要約が fallback ならルール要約を選ぶ', () => {
    const selection = selectBriefSummary({
      ai_summary: buildAiSummary({ is_fallback: true, provider: 'rule' }),
      rule_summary: buildRuleSummary(),
    });
    expect(selection.kind).toBe('rule');
    expect(selection.generationId).toBe('gen_rule_1');
    expect(selection.bullets).toEqual(['ルール由来の確認事項']);
  });

  it('provider が openai でも fallback フラグが立っていればルール要約を選ぶ', () => {
    const selection = selectBriefSummary({
      ai_summary: buildAiSummary({ is_fallback: true }),
      rule_summary: buildRuleSummary(),
    });
    expect(selection.kind).toBe('rule');
  });
});

describe('composeBriefParagraph', () => {
  it('headline と bullets を「。」で補完して 1 段落に合成する', () => {
    const paragraph = composeBriefParagraph({
      headline: '前回から利尿薬が追加されています',
      bullets: [
        'ふらつき・脱水・食事量の変化を確認してください',
        '・服薬カレンダーの場所も確認します。',
      ],
    });
    expect(paragraph).toBe(
      '前回から利尿薬が追加されています。ふらつき・脱水・食事量の変化を確認してください。服薬カレンダーの場所も確認します。',
    );
  });

  it('最大文数(既定 4 文)を超える bullets は切り捨てる', () => {
    const paragraph = composeBriefParagraph({
      headline: '一文目',
      bullets: ['二文目', '三文目', '四文目', '五文目'],
    });
    expect(paragraph).toBe('一文目。二文目。三文目。四文目。');
  });

  it('空行と重複文は除外する', () => {
    const paragraph = composeBriefParagraph({
      headline: '同じ文',
      bullets: ['', '  ', '同じ文。', '別の文'],
    });
    expect(paragraph).toBe('同じ文。別の文。');
  });

  it('全て空なら空文字を返す', () => {
    expect(composeBriefParagraph({ headline: '', bullets: [] })).toBe('');
  });
});

describe('formatBriefGeneratedAt', () => {
  it('ISO 文字列を YYYY-MM-DD HH:mm 表記にする', () => {
    expect(formatBriefGeneratedAt('2026-06-13T08:30:00.000Z')).toBe('2026-06-13 08:30');
  });
});

describe('mapConfirmChoiceToFeedback', () => {
  it('「内容は正しい」は helpful にマッピングする', () => {
    expect(mapConfirmChoiceToFeedback('correct')).toEqual({ rating: 'helpful' });
  });

  it('「一部修正する」は needs_review + comment にマッピングする', () => {
    expect(mapConfirmChoiceToFeedback('needs_edit')).toEqual({
      rating: 'needs_review',
      comment: '一部修正する',
    });
  });

  it('「このまとめは使わない」は needs_review + comment にマッピングする', () => {
    expect(mapConfirmChoiceToFeedback('do_not_use')).toEqual({
      rating: 'needs_review',
      comment: 'このまとめは使わない',
    });
  });

  it('3 択の表示順とラベルが design target と一致する', () => {
    expect(PHARMACIST_CONFIRM_CHOICES.map((choice) => choice.label)).toEqual([
      '内容は正しい',
      '一部修正する',
      'このまとめは使わない',
    ]);
  });
});

describe('validateCorrectedSummary', () => {
  it('前後の空白を除いた本文を返し error は null になる', () => {
    expect(validateCorrectedSummary('  修正後のまとめ  ')).toEqual({
      value: '修正後のまとめ',
      error: null,
    });
  });

  it('空白のみは入力必須エラーを返す', () => {
    expect(validateCorrectedSummary('   ')).toEqual({
      value: '',
      error: '修正後のまとめを入力してください',
    });
  });

  it('上限文字数を超えるとエラーを返す', () => {
    const tooLong = 'あ'.repeat(CORRECTED_SUMMARY_MAX_LENGTH + 1);
    const result = validateCorrectedSummary(tooLong);
    expect(result.error).toBe(
      `修正後のまとめは${CORRECTED_SUMMARY_MAX_LENGTH}文字以内で入力してください`,
    );
  });

  it('上限ちょうどは許容する', () => {
    const exact = 'あ'.repeat(CORRECTED_SUMMARY_MAX_LENGTH);
    expect(validateCorrectedSummary(exact).error).toBeNull();
  });
});

describe('buildNeedsEditFeedbackInput', () => {
  it('needs_review + 「一部修正する」マーカー + 訂正後本文を組み立てる', () => {
    expect(buildNeedsEditFeedbackInput('修正後のまとめ')).toEqual({
      rating: 'needs_review',
      comment: '一部修正する',
      corrected_summary: '修正後のまとめ',
    });
  });
});

describe('resolveEvidenceLinks', () => {
  it('患者詳細の実在タブへリンクを解決する', () => {
    const links = resolveEvidenceLinks('patient_1');
    expect(links.map((link) => link.label)).toEqual([
      '処方せん',
      '前回訪問メモ',
      '訪看メモ',
      '検査値',
      '残薬写真',
    ]);
    expect(links.map((link) => link.href)).toEqual([
      '/patients/patient_1#card-prescription-section',
      '/patients/patient_1#card-recent-activities',
      '/patients/patient_1/collaboration',
      '/patients/patient_1#patient-profile-summary',
      '/patients/patient_1#patient-profile-summary',
    ]);
  });

  it('患者未解決時は全カードをリンク無しにする', () => {
    const links = resolveEvidenceLinks(null);
    expect(links).toHaveLength(5);
    expect(links.every((link) => link.href === null)).toBe(true);
  });
});

describe('pickVisitPatientId', () => {
  it('patient_id 文字列を取り出す', () => {
    expect(pickVisitPatientId({ patient_id: 'patient_1' })).toBe('patient_1');
  });

  it('欠損・空文字・非文字列・非オブジェクトは null を返す', () => {
    expect(pickVisitPatientId({})).toBeNull();
    expect(pickVisitPatientId({ patient_id: '' })).toBeNull();
    expect(pickVisitPatientId({ patient_id: 123 })).toBeNull();
    expect(pickVisitPatientId(null)).toBeNull();
    expect(pickVisitPatientId('patient_1')).toBeNull();
  });
});
