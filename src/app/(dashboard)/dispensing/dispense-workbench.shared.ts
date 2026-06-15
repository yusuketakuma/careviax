import { differenceInMinutes, format, parseISO } from 'date-fns';

/**
 * design/images/new 07_dispense / 08_audit ワークベンチ共通の純関数・型。
 * 文言ルール: ブロッカー→「止まっている理由」/ Next Action→「次にやること」。
 * 静止画原則: 期限・経過のラベル形式をデザイン PNG と一致させる
 * (期限 12:00 — あと2時間18分 / 2時間止まっていた件 — 09:31に解除 等)。
 */

// ── /api/dispense-tasks/[id]/workbench レスポンス型 ──

export type WorkbenchComparisonRow = {
  key: string;
  drug_name: string;
  previous_label: string | null;
  current_label: string | null;
  change_type: 'added' | 'removed' | 'dose_changed' | 'frequency_changed' | null;
  direction: 'decrease' | 'increase' | null;
  inquiry_origin: boolean;
};

export type WorkbenchCountRow = {
  line_id: string;
  result_id: string | null;
  drug_name: string;
  tags: string[];
  is_narcotic: boolean;
  prescribed_label: string;
  prescribed_quantity: number | null;
  dispensed_label: string | null;
  dispensed_quantity: number | null;
  unit: string;
};

export type DispenseWorkbenchData = {
  task: { id: string; status: string; priority: string; due_date: string | null };
  cycle: { id: string; overall_status: string };
  patient: { id: string; name: string };
  intake: { id: string; prescribed_date: string } | null;
  previous_intake: { prescribed_date: string } | null;
  safety: {
    allergy: string | null;
    renal: string | null;
    handling_tags: string[];
    swallowing: string | null;
    cautions: string[];
  };
  comparison: WorkbenchComparisonRow[];
  count_rows: WorkbenchCountRow[];
  dispenser: { id: string; name: string; time_label: string | null } | null;
  auditor: { id: string; name: string };
  is_self_audit: boolean;
  has_narcotic: boolean;
  visit_time_label: string | null;
  resolved_inquiry: {
    inquired_at: string;
    resolved_at: string | null;
    institution: string | null;
    change_detail: string | null;
  } | null;
  team_audit_total: number;
  stock_check_date_label: string | null;
};

export type DispenseSafetySummary = {
  changedCount: number;
  inquiryChangeCount: number;
  inquiryResponseNeedsCheck: boolean;
  unresolvedPrescriptionQuantityCount: number;
  missingActualQuantityCount: number;
  specialHandlingLabels: string[];
  nextCheckLabel: string;
};

// ── ラベル合成 ──

/** 姓のみ(例 '佐藤 花子' → '佐藤')。空白区切りがなければそのまま。 */
export function familyName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** 期限 HH:mm(例 '12:00')。 */
export function formatDueTime(dueIso: string | null): string | null {
  if (!dueIso) return null;
  const date = parseISO(dueIso);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'HH:mm');
}

/** 『あと2時間18分』。期限超過は『超過X分』。 */
export function formatRemainingLabel(dueIso: string | null, now: Date = new Date()): string | null {
  if (!dueIso) return null;
  const due = parseISO(dueIso);
  if (Number.isNaN(due.getTime())) return null;
  const minutes = differenceInMinutes(due, now);
  if (minutes < 0) {
    const overdue = Math.abs(minutes);
    return overdue >= 60
      ? `超過${Math.floor(overdue / 60)}時間${overdue % 60}分`
      : `超過${overdue}分`;
  }
  if (minutes >= 60) return `あと${Math.floor(minutes / 60)}時間${minutes % 60}分`;
  return `あと${minutes}分`;
}

/** 『2時間止まっていた件 — 09:31に解除』(照会で止まり、回答で解除された件)。 */
export function buildPausedLabel(
  inquiredAtIso: string,
  resolvedAtIso: string | null,
): string | null {
  if (!resolvedAtIso) return null;
  const inquiredAt = parseISO(inquiredAtIso);
  const resolvedAt = parseISO(resolvedAtIso);
  if (Number.isNaN(inquiredAt.getTime()) || Number.isNaN(resolvedAt.getTime())) return null;
  const minutes = Math.max(0, differenceInMinutes(resolvedAt, inquiredAt));
  const duration = minutes >= 60 ? `${Math.round(minutes / 60)}時間` : `${minutes}分`;
  return `${duration}止まっていた件 — ${format(resolvedAt, 'HH:mm')}に解除`;
}

/** 07 左キュー行のサブ文言。選択行は照会変更の有無で詳細化する。 */
export function buildDispenseQueueSubline(args: {
  overallStatus: string;
  hasInquiryChange?: boolean;
}): string {
  if (args.overallStatus === 'inquiry_resolved') {
    return args.hasInquiryChange ? '照会回答の反映 — 用量変更あり' : '照会回答の反映';
  }
  if (args.overallStatus === 'dispensing') return '調剤の続きから';
  return '定期・変更なし';
}

/** 07 比較テーブル「差」列のバッジ文言。 */
export function buildChangeBadge(row: {
  change_type: WorkbenchComparisonRow['change_type'];
  direction: WorkbenchComparisonRow['direction'];
}): { label: string; tone: 'amber' | 'red' | 'blue' | 'neutral' } | null {
  switch (row.change_type) {
    case 'dose_changed':
      if (row.direction === 'decrease') return { label: '減量', tone: 'amber' };
      if (row.direction === 'increase') return { label: '増量', tone: 'amber' };
      return { label: '用量変更', tone: 'amber' };
    case 'frequency_changed':
      return { label: '用法変更', tone: 'amber' };
    case 'added':
      return { label: '新規', tone: 'blue' };
    case 'removed':
      return { label: '中止', tone: 'red' };
    default:
      return null;
  }
}

const HANDLING_TAG_LABELS: Record<string, string> = {
  narcotic: '麻薬',
  cold_storage: '冷所',
  high_risk: 'ハイリスク',
  lasa: 'LASA',
  unit_dose: '一包化',
};

export function buildDispenseSafetySummary(
  workbench: DispenseWorkbenchData,
): DispenseSafetySummary {
  const changedRows = workbench.comparison.filter((row) => row.change_type != null);
  const directInquiryChangeCount = changedRows.filter((row) => row.inquiry_origin).length;
  const inquiryResponseNeedsCheck =
    directInquiryChangeCount > 0 || Boolean(workbench.resolved_inquiry?.change_detail?.trim());
  const unresolvedPrescriptionQuantityCount = workbench.count_rows.filter(
    (row) => row.prescribed_quantity == null,
  ).length;
  const missingActualQuantityCount = workbench.count_rows.filter(
    (row) => row.dispensed_quantity == null,
  ).length;
  const specialHandlingLabels = [
    ...new Set(
      [
        ...workbench.safety.handling_tags,
        ...workbench.count_rows.flatMap((row) => row.tags),
        ...(workbench.has_narcotic ? ['narcotic'] : []),
      ]
        .map((tag) => HANDLING_TAG_LABELS[tag] ?? tag)
        .filter((label) => label.length > 0),
    ),
  ];

  let nextCheckLabel = '変更点と計数を確認';
  if (unresolvedPrescriptionQuantityCount > 0) {
    nextCheckLabel = '処方数量未確定を処方取込で確認';
  } else if (inquiryResponseNeedsCheck) {
    nextCheckLabel = '照会回答の変更点を読み上げ確認';
  } else if (specialHandlingLabels.length > 0) {
    nextCheckLabel = `${specialHandlingLabels[0]}の取扱いを先に確認`;
  }

  return {
    changedCount: changedRows.length,
    inquiryChangeCount: Math.max(directInquiryChangeCount, inquiryResponseNeedsCheck ? 1 : 0),
    inquiryResponseNeedsCheck,
    unresolvedPrescriptionQuantityCount,
    missingActualQuantityCount,
    specialHandlingLabels,
    nextCheckLabel,
  };
}

/** 経過分 → 『1日』『2時間』『30分』。 */
export function formatAgeMinutesLabel(minutes: number): string {
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}日`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}時間`;
  return `${Math.max(0, Math.round(minutes))}分`;
}

// ── 08 ダブルカウント判定 ──

export type CountJudgement = 'match' | 'mismatch' | 'pending';

/**
 * 計数判定: 調剤実績量と 1 回目 / 2 回目の計数がすべて一致して初めて『一致』。
 * どれかが未入力なら『—(未確定)』、入力済みでズレがあれば『不一致』。
 */
export function judgeCountRow(
  dispensedQuantity: number | null,
  firstCount: number | null,
  secondCount: number | null,
): CountJudgement {
  if (dispensedQuantity == null || firstCount == null || secondCount == null) return 'pending';
  return dispensedQuantity === firstCount && dispensedQuantity === secondCount
    ? 'match'
    : 'mismatch';
}

export type CountEntryState = Record<string, { first: number | null; second: number | null }>;

/** 全行が『一致』なら合格可能(差異ゼロ)。行が無い場合は不可。 */
export function canApproveCounts(rows: WorkbenchCountRow[], entries: CountEntryState): boolean {
  if (rows.length === 0) return false;
  return rows.every(
    (row) =>
      judgeCountRow(
        row.dispensed_quantity,
        entries[row.line_id]?.first ?? null,
        entries[row.line_id]?.second ?? null,
      ) === 'match',
  );
}

/** 右レール『次にやること』: 未入力の計数が残る行(麻薬を優先)。 */
export function findNextCountTarget(
  rows: WorkbenchCountRow[],
  entries: CountEntryState,
): { row: WorkbenchCountRow; slot: 'first' | 'second' } | null {
  const ordered = [...rows].sort((a, b) => Number(b.is_narcotic) - Number(a.is_narcotic));
  for (const slot of ['first', 'second'] as const) {
    const target = ordered.find((row) => (entries[row.line_id]?.[slot] ?? null) == null);
    if (target) return { row: target, slot };
  }
  return null;
}
