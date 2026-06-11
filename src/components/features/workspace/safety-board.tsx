'use client';

import { cn } from '@/lib/utils';

/**
 * design/images/new 共通のセーフティボード(06_card 最上部の赤枠カード)。
 * アレルギー / 腎機能 / 取扱タグ / 嚥下 / 注意を、どの工程でも常時表示する。
 * 危険タグ(麻薬=赤・冷所=ティール・一包化=青 等)は絶対に隠さない。
 * データ未提供の行は出さない(全行未提供なら何も描画しない)。
 */

type HandlingTagTone = 'narcotic' | 'cold' | 'unitDose' | 'caution' | 'neutral';

/**
 * タグ→トーンの対応。既存 PackagingInstructionTag 語彙(src/lib/dispensing/packaging.ts)の
 * 機械キーと、日本語表記(API が表示名で返す場合)の両方を受け付ける。
 */
const HANDLING_TAG_TONE_MAP: Record<string, HandlingTagTone> = {
  // 麻薬 = 赤枠赤字
  narcotic: 'narcotic',
  麻薬: 'narcotic',
  // 冷所 = ティール系
  cold_storage: 'cold',
  冷所: 'cold',
  冷所保管: 'cold',
  // 一包化 = 青系
  unit_dose: 'unitDose',
  一包化: 'unitDose',
  morning_evening_unit_dose: 'unitDose',
  朝夕別一包化: 'unitDose',
  // 取り違え注意系 = 橙
  half_tablet: 'caution',
  '半錠・分割': 'caution',
  crush_prohibited: 'caution',
  粉砕禁止: 'caution',
  // その他の取扱指示 = 中立
  separate_pack: 'neutral',
  別包: 'neutral',
  staple_required: 'neutral',
  ホッチキス止め: 'neutral',
  label_required: 'neutral',
  名前ラベル: 'neutral',
};

const HANDLING_TAG_TONE_CLASSES: Record<HandlingTagTone, string> = {
  narcotic: 'border-red-500 bg-red-50 font-semibold text-red-700',
  cold: 'border-teal-400 bg-teal-50 text-teal-700',
  unitDose: 'border-blue-300 bg-blue-50 text-blue-700',
  caution: 'border-amber-400 bg-amber-50 text-amber-700',
  neutral: 'border-border bg-background text-muted-foreground',
};

/** 機械キー → 新デザインの短い表示名(例 cold_storage → 冷所)。未知タグはそのまま表示。 */
const HANDLING_TAG_DISPLAY_LABELS: Record<string, string> = {
  narcotic: '麻薬',
  cold_storage: '冷所',
  unit_dose: '一包化',
  morning_evening_unit_dose: '朝夕別一包化',
  half_tablet: '半錠・分割',
  crush_prohibited: '粉砕禁止',
  separate_pack: '別包',
  staple_required: 'ホッチキス止め',
  label_required: '名前ラベル',
};

export function getHandlingTagBadgeClass(tag: string): string {
  const tone = HANDLING_TAG_TONE_MAP[tag] ?? 'neutral';
  return HANDLING_TAG_TONE_CLASSES[tone];
}

export function getHandlingTagLabel(tag: string): string {
  return HANDLING_TAG_DISPLAY_LABELS[tag] ?? tag;
}

export type SafetyBoardProps = {
  /** 例: セフェム系(発疹 2019) */
  allergy?: string;
  /** 例: eGFR 38(6/1)要減量 */
  renal?: string;
  /** 取扱タグ。PackagingInstructionTag のキー(narcotic 等)または日本語表記(麻薬 等) */
  handlingTags?: string[];
  /** 例: 錠剤OK・大きい錠は半割 */
  swallowing?: string;
  /** 自由文の注意。例: ふらつき(6/5〜経過観察) */
  cautions?: string[];
  className?: string;
};

export function SafetyBoard({
  allergy,
  renal,
  handlingTags,
  swallowing,
  cautions,
  className,
}: SafetyBoardProps) {
  const tags = handlingTags ?? [];
  const cautionItems = (cautions ?? []).filter((caution) => caution.trim().length > 0);
  const hasContent =
    Boolean(allergy || renal || swallowing) || tags.length > 0 || cautionItems.length > 0;
  if (!hasContent) return null;

  return (
    <section
      aria-label="セーフティボード"
      className={cn('rounded-lg border-2 border-red-300 bg-red-50/50 p-4', className)}
      data-testid="safety-board"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-sm font-bold text-red-700">セーフティボード</h3>
        <span className="text-xs text-red-700/80">どの工程でも常時表示</span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {allergy ? (
          <div data-testid="safety-board-allergy">
            <dt className="text-xs font-medium text-red-800/70">アレルギー</dt>
            <dd className="mt-0.5 text-sm font-bold leading-6 text-foreground">{allergy}</dd>
          </div>
        ) : null}
        {renal ? (
          <div data-testid="safety-board-renal">
            <dt className="text-xs font-medium text-red-800/70">腎機能</dt>
            <dd className="mt-0.5 text-sm font-bold leading-6 text-foreground">{renal}</dd>
          </div>
        ) : null}
        {tags.length > 0 ? (
          <div data-testid="safety-board-handling">
            <dt className="text-xs font-medium text-red-800/70">取扱</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                    getHandlingTagBadgeClass(tag),
                  )}
                >
                  {getHandlingTagLabel(tag)}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        {swallowing ? (
          <div data-testid="safety-board-swallowing">
            <dt className="text-xs font-medium text-red-800/70">嚥下</dt>
            <dd className="mt-0.5 text-sm font-bold leading-6 text-foreground">{swallowing}</dd>
          </div>
        ) : null}
        {cautionItems.length > 0 ? (
          <div className="sm:col-span-2 lg:col-span-4" data-testid="safety-board-cautions">
            <dt className="text-xs font-medium text-red-800/70">注意</dt>
            <dd className="mt-0.5 text-sm font-bold leading-6 text-foreground">
              {cautionItems.map((caution) => (
                <span key={caution} className="block">
                  {caution}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
