import { addDays, format, parseISO } from 'date-fns';

/**
 * p0_10「処方入力・服用期間」レビューの表示モデル(純関数)。
 * 入力中の処方明細から、いつからいつまでの薬か・加工する薬かを
 * 7列テーブル+加工チップ+止まっている理由に変換する。
 */

export type PeriodReviewLineInput = {
  drug_name: string;
  frequency: string;
  days: number;
  start_date?: string;
  end_date?: string;
  dispensing_method?: string;
  packaging_instructions?: string;
  notes?: string;
};

export type PeriodReviewRow = {
  drugName: string;
  frequencyLabel: string;
  daysLabel: string;
  startLabel: string;
  endLabel: string;
  processingKey: ProcessingChipKey;
  processingLabel: string;
  noteLabel: string;
};

export type ProcessingChipKey =
  | 'unit_dose'
  | 'crushed'
  | 'no_packaging'
  | 'separate_pack'
  | 'outside_set';

export const PROCESSING_CHIP_DEFS: Array<{
  key: ProcessingChipKey;
  label: string;
  description: string;
}> = [
  { key: 'unit_dose', label: '一包化', description: '服用時点ごとにまとめる' },
  { key: 'crushed', label: '粉砕', description: '飲み込みやすくする' },
  { key: 'no_packaging', label: '分包しない', description: 'そのまま渡す' },
  { key: 'separate_pack', label: '別包', description: '他の薬と分ける' },
  { key: 'outside_set', label: 'セット対象外', description: '持参・別管理' },
];

const PROCESSING_LABELS: Record<ProcessingChipKey, string> = {
  unit_dose: '一包化',
  crushed: '粉砕',
  no_packaging: '分包なし',
  separate_pack: '別包',
  outside_set: 'セット対象外',
};

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseDateOrNull(value: string | undefined): Date | null {
  if (!hasText(value)) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 行の加工・セット分類。包装指示(自由文)の別包/セット対象外を調剤方法より優先する。 */
export function classifyLineProcessing(line: PeriodReviewLineInput): ProcessingChipKey {
  const instructions = line.packaging_instructions ?? '';
  if (instructions.includes('セット対象外') || instructions.includes('持参')) {
    return 'outside_set';
  }
  if (instructions.includes('別包')) return 'separate_pack';
  if (line.dispensing_method === 'unit_dose') return 'unit_dose';
  if (line.dispensing_method === 'crushed') return 'crushed';
  return 'no_packaging';
}

/** 入力済み行(薬剤名あり)だけを期間レビュー行へ変換する。 */
export function buildPeriodReviewRows(lines: PeriodReviewLineInput[]): PeriodReviewRow[] {
  return lines
    .filter((line) => hasText(line.drug_name))
    .map((line) => {
      const start = parseDateOrNull(line.start_date);
      const explicitEnd = parseDateOrNull(line.end_date);
      const computedEnd =
        explicitEnd ?? (start && line.days > 0 ? addDays(start, line.days - 1) : null);
      const processingKey = classifyLineProcessing(line);

      return {
        drugName: line.drug_name,
        frequencyLabel: hasText(line.frequency) ? line.frequency : '未入力',
        daysLabel: line.days > 0 ? `${line.days}日` : '未入力',
        startLabel: start ? format(start, 'M/d') : '未設定',
        endLabel: computedEnd ? format(computedEnd, 'M/d') : '未設定',
        processingKey,
        processingLabel: PROCESSING_LABELS[processingKey],
        noteLabel: hasText(line.notes) ? line.notes : '—',
      };
    });
}

/** ヘッダの「今回の薬:開始〜終了」。期間が1行も無ければ null。 */
export function buildPeriodSummaryLabel(lines: PeriodReviewLineInput[]): string | null {
  const filled = lines.filter((line) => hasText(line.drug_name));
  let min: Date | null = null;
  let max: Date | null = null;
  for (const line of filled) {
    const start = parseDateOrNull(line.start_date);
    const end =
      parseDateOrNull(line.end_date) ??
      (start && line.days > 0 ? addDays(start, line.days - 1) : null);
    if (start && (!min || start < min)) min = start;
    if (end && (!max || end > max)) max = end;
  }
  if (!min || !max) return null;
  return `${format(min, 'yyyy/MM/dd')}〜${format(max, 'yyyy/MM/dd')}`;
}

export type ProcessingChip = {
  key: ProcessingChipKey;
  label: string;
  description: string;
  count: number;
  active: boolean;
};

/** 加工指定チップ。現在の明細で使われている加工が active(青)になる。 */
export function buildProcessingChips(lines: PeriodReviewLineInput[]): ProcessingChip[] {
  const rows = buildPeriodReviewRows(lines);
  return PROCESSING_CHIP_DEFS.map((def) => {
    const count = rows.filter((row) => row.processingKey === def.key).length;
    return { ...def, count, active: count > 0 };
  });
}

export type PeriodReviewNotice = {
  severity: 'critical' | 'caution';
  text: string;
};

/**
 * 「止まっている理由」。粉砕は薬剤師確認必須(赤)、中止薬メモは回収予定の確認(橙)、
 * 登録ブロッカーは橙でそのまま流す。
 */
export function buildPeriodReviewNotices(args: {
  lines: PeriodReviewLineInput[];
  submitBlockers: string[];
}): PeriodReviewNotice[] {
  const notices: PeriodReviewNotice[] = [];
  const rows = buildPeriodReviewRows(args.lines);

  if (rows.some((row) => row.processingKey === 'crushed')) {
    notices.push({ severity: 'critical', text: '粉砕可否は薬剤師確認が必要です' });
  }
  const mentionsDiscontinued = args.lines.some(
    (line) =>
      hasText(line.drug_name) &&
      ((line.notes ?? '').includes('中止') || (line.packaging_instructions ?? '').includes('中止')),
  );
  if (mentionsDiscontinued) {
    notices.push({ severity: 'caution', text: '中止薬の回収予定を確認してください' });
  }
  for (const blocker of args.submitBlockers) {
    notices.push({ severity: 'caution', text: blocker });
  }
  return notices;
}
