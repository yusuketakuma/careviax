import { buildPatientHref } from '@/lib/patient/navigation';
import type { VisitBrief } from '@/types/visit-brief';

/**
 * p1_03「訪問前まとめを確認」の表示モデル(純関数)。
 * VisitBrief の AI/ルール要約を本文段落へ合成し、根拠カードのリンク先と
 * 薬剤師 3 択 → visit-brief-feedback API(2 値 rating)の対応を決める。
 */

export type BriefSummarySelection = {
  kind: 'ai' | 'rule';
  generationId: string;
  headline: string;
  bullets: string[];
};

/**
 * 本文に使う要約を選ぶ。
 * AI 生成が有効(provider=openai かつ非 fallback)なら AI 要約、
 * fallback(ルール代替)時はルール要約を使う(visit-brief-card と同じ判定)。
 */
export function selectBriefSummary(
  brief: Pick<VisitBrief, 'ai_summary' | 'rule_summary'>,
): BriefSummarySelection {
  const ai = brief.ai_summary;
  if (ai.provider === 'openai' && !ai.is_fallback) {
    return {
      kind: 'ai',
      generationId: ai.generation_id,
      headline: ai.headline,
      bullets: ai.bullets,
    };
  }
  return {
    kind: 'rule',
    generationId: brief.rule_summary.generation_id,
    headline: brief.rule_summary.headline,
    bullets: brief.rule_summary.bullets,
  };
}

/** 箇条書き 1 行を文へ正規化する(行頭記号の除去、文末「。」の補完)。 */
function normalizeBriefSentence(text: string): string {
  const trimmed = text.replace(/^[・\-\s]+/, '').trim();
  if (!trimmed) return '';
  return /[。.!?!?]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

/**
 * headline と bullets を 1 つの段落(最大 maxSentences 文)へ合成する。
 * 重複文と空行は除き、design target の「3〜4 文の段落」に合わせる。
 */
export function composeBriefParagraph(
  summary: Pick<BriefSummarySelection, 'headline' | 'bullets'>,
  maxSentences = 4,
): string {
  const seen = new Set<string>();
  const sentences: string[] = [];
  for (const line of [summary.headline, ...summary.bullets]) {
    const sentence = normalizeBriefSentence(line);
    if (!sentence || seen.has(sentence)) continue;
    seen.add(sentence);
    sentences.push(sentence);
    if (sentences.length >= maxSentences) break;
  }
  return sentences.join('');
}

/** ISO 文字列を「YYYY-MM-DD HH:mm」表示へ(visit-brief-card と同じ簡易表記)。 */
export function formatBriefGeneratedAt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export type PharmacistConfirmChoice = 'correct' | 'needs_edit' | 'do_not_use';

/** 「薬剤師の確認」3 択(design target の表示順)。 */
export const PHARMACIST_CONFIRM_CHOICES: ReadonlyArray<{
  value: PharmacistConfirmChoice;
  label: string;
}> = [
  { value: 'correct', label: '内容は正しい' },
  { value: 'needs_edit', label: '一部修正する' },
  { value: 'do_not_use', label: 'このまとめは使わない' },
];

export type BriefFeedbackInput = {
  rating: 'helpful' | 'needs_review';
  comment?: string;
  /** 「一部修正する」で薬剤師が編集・保存した訂正後の本文(任意)。 */
  corrected_summary?: string;
};

/**
 * 3 択 → visit-brief-feedback API の rating 2 値へのマッピング。
 * 「内容は正しい」= helpful、修正系の 2 択は needs_review とし comment で区別する。
 */
export function mapConfirmChoiceToFeedback(choice: PharmacistConfirmChoice): BriefFeedbackInput {
  if (choice === 'correct') return { rating: 'helpful' };
  if (choice === 'needs_edit') return { rating: 'needs_review', comment: '一部修正する' };
  return { rating: 'needs_review', comment: 'このまとめは使わない' };
}

/** 訂正後本文の最大文字数(AuditLog の changes へ構造化保存する想定の上限)。 */
export const CORRECTED_SUMMARY_MAX_LENGTH = 2000;

/**
 * 「一部修正する」の編集本文を検証する純関数。
 * 空(空白のみ)、または上限超過を弾き、UI に出すエラーメッセージを返す。
 * 問題なければ trim 済みの本文と error: null を返す。
 */
export function validateCorrectedSummary(raw: string): {
  value: string;
  error: string | null;
} {
  const value = raw.trim();
  if (!value) {
    return { value, error: '修正後のまとめを入力してください' };
  }
  if (value.length > CORRECTED_SUMMARY_MAX_LENGTH) {
    return {
      value,
      error: `修正後のまとめは${CORRECTED_SUMMARY_MAX_LENGTH}文字以内で入力してください`,
    };
  }
  return { value, error: null };
}

/**
 * 「一部修正する」を訂正本文つきで保存するときの feedback 入力を組み立てる。
 * rating は needs_review、comment は 3 択マーカー(「一部修正する」)を維持しつつ、
 * 訂正後本文を corrected_summary として付与する(schema-free に AuditLog へ保存)。
 */
export function buildNeedsEditFeedbackInput(correctedSummary: string): BriefFeedbackInput {
  return {
    rating: 'needs_review',
    comment: '一部修正する',
    corrected_summary: correctedSummary,
  };
}

export type EvidenceLink = {
  key: string;
  label: string;
  description: string;
  href: string | null;
};

/**
 * 「根拠になる情報」カードのリンク先。
 * 現行の患者カード作業台または専用 route へ解決し、患者未解決時はリンク無しにする。
 */
export function resolveEvidenceLinks(patientId: string | null): EvidenceLink[] {
  const patientHref = (anchor = '') => (patientId ? buildPatientHref(patientId, anchor) : null);
  return [
    {
      key: 'prescription',
      label: '処方せん',
      description: '患者カードの処方セクションで前回比較を開く',
      href: patientHref('#card-prescription-section'),
    },
    {
      key: 'last_visit_note',
      label: '前回訪問メモ',
      description: '患者カードの直近の動きを開く',
      href: patientHref('#card-recent-activities'),
    },
    {
      key: 'nursing_note',
      label: '訪看メモ',
      description: '多職種共有を開く',
      href: patientId ? buildPatientHref(patientId, '/collaboration') : null,
    },
    {
      key: 'labs',
      label: '検査値',
      description: '患者プロフィールの基本条件を開く',
      href: patientHref('#patient-profile-summary'),
    },
    {
      key: 'residual_photo',
      label: '残薬写真',
      description: '患者カードの根拠・記録を開く',
      href: patientHref('#patient-profile-summary'),
    },
  ];
}

/** 訪問予定/訪問記録 API レスポンスから patient_id を安全に取り出す。 */
export function pickVisitPatientId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const patientId = (payload as { patient_id?: unknown }).patient_id;
  return typeof patientId === 'string' && patientId.length > 0 ? patientId : null;
}
