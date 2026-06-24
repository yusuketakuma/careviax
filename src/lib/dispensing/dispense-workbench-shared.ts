import { differenceInMinutes, format, parseISO } from 'date-fns';
import type { MedicationCycleStatus } from '@prisma/client';
import { generatePackagingGroups, parseFrequencyToSlots } from '@/lib/dispensing/packaging-group';
import { familyNameOf as familyName } from '@/lib/utils/person-name';

export { familyName };

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
  line_number: number | null;
  drug_name: string;
  dose: string | null;
  frequency: string;
  route: string | null;
  tags: string[];
  is_narcotic: boolean;
  is_generic: boolean;
  prescribed_label: string;
  prescribed_quantity: number | null;
  start_date: string | null;
  end_date: string | null;
  days: number | null;
  line_updated_at: string;
  dispensed_label: string | null;
  dispensed_at: string | null;
  dispensed_quantity: number | null;
  discrepancy_reason: string | null;
  unit: string;
  dispensing_method: string | null;
  packaging_method: string | null;
  packaging_instructions: string | null;
  packaging_group_id: string | null;
};

export type WorkbenchPackagingGroup = {
  id: string;
  label: string;
  method: string;
  slot: string | null;
  sort_order: number;
  version: number;
};

export type DispenseWorkbenchData = {
  task: { id: string; status: string; priority: string; due_date: string | null };
  cycle: { id: string; overall_status: string; version: number };
  patient: { id: string; name: string };
  intake: {
    id: string;
    prescribed_date: string;
    prescriber_institution: string | null;
    prescriber_name: string | null;
  } | null;
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
  packaging_groups?: WorkbenchPackagingGroup[];
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

export type DispenseMedicationGroupMethod =
  | 'none'
  | 'unit_dose'
  | 'morning_evening_unit_dose'
  | 'medication_box'
  | 'calendar_pack'
  | 'blister_pack'
  | 'crush_and_pack'
  | 'other';

export type DispenseMedicationGroup = {
  id: string;
  label: string;
  slot: string | null;
  method: DispenseMedicationGroupMethod;
  methodLabel: string;
  lineIds: string[];
  lineNames: string[];
  crushProhibitedCount: number;
  cautionLabels: string[];
};

export type MedicationDoseSlotKey = 'morning' | 'noon' | 'evening' | 'bedtime';

export type MedicationFormatDoseSlot = {
  key: MedicationDoseSlotKey;
  label: string;
  text: string;
  status: 'scheduled' | 'none' | 'needs_check';
};

export type MedicationFormatGroupKind =
  | 'unit_dose'
  | 'separate_pack'
  | 'do_not_package'
  | 'crush_and_pack'
  | 'prn'
  | 'non_internal'
  | 'other';

export type MedicationFormatLine = {
  lineId: string;
  lineNumber: number | null;
  drugName: string;
  usage: string;
  doseText: string | null;
  days: number | null;
  quantityLabel: string;
  dispensedLabel: string | null;
  unit: string;
  slots: Record<MedicationDoseSlotKey, MedicationFormatDoseSlot>;
  processingLabels: string[];
  cautionLabels: string[];
  notes: string[];
  statusLabel: string;
};

export type MedicationFormatGroup = {
  id: string;
  kind: MedicationFormatGroupKind;
  label: string;
  description: string;
  sortOrder: number;
  lines: MedicationFormatLine[];
};

// ── ラベル合成 ──

/** 姓のみ(例 '佐藤 花子' → '佐藤')。空白区切りがなければそのまま。 */
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

// ── 患者中心リスト(/api/dispense-workbench/patients) 共通型・純関数 ──

/** 状態バッジ3値: 監査済 / 作業中 / 未着手 (MedicationCycle.overall_status 16値の畳み込み)。 */
export type DispenseWorkbenchListBadge = 'audited' | 'in_progress' | 'not_started';

/** 患者×最新サイクルの一覧行(API レスポンス公開型)。 */
export type DispenseWorkbenchPatientRow = {
  patient_id: string;
  cycle_id: string | null;
  name: string;
  name_kana: string;
  /** 最新サイクルの overall_status (サイクル未生成なら null)。 */
  overall_status: string | null;
  badge: DispenseWorkbenchListBadge;
  /** 服用開始日 'yyyy-MM-dd' (CareCase.start_date 優先、無ければ最古の処方行 start_date)。 */
  start_date: string | null;
  /** 登録日 'yyyy-MM-dd' (Patient.created_at)。 */
  registered_date: string;
  /** 患者に紐づく最新 SetPlan。未作成なら null。 */
  latest_set_plan_id: string | null;
  /** 最新 SetPlan が属する cycle_id。未作成なら null。 */
  latest_set_plan_cycle_id: string | null;
};

export type DispenseWorkbenchPatientsResponse = {
  data: DispenseWorkbenchPatientRow[];
};

/**
 * MedicationCycle.overall_status(16値) → 一覧バッジ3値。
 * 監査完了以降(audited〜reported)=audited、調剤着手以降〜監査前=in_progress、
 * それ以前(intake_received〜ready_to_dispense)と例外(on_hold/cancelled)=not_started。
 */
export function deriveListBadge(
  status: MedicationCycleStatus | string | null,
): DispenseWorkbenchListBadge {
  switch (status) {
    case 'audited':
    case 'setting':
    case 'set_audited':
    case 'visit_ready':
    case 'visit_completed':
    case 'reported':
      return 'audited';
    case 'dispensing':
    case 'dispensed':
    case 'audit_pending':
      return 'in_progress';
    default:
      // intake_received / structuring / inquiry_pending / inquiry_resolved /
      // ready_to_dispense / on_hold / cancelled / null
      return 'not_started';
  }
}

/** ワークベンチ 4 工程（API 境界の URL 表記）。内部 Phase の setp/seta はルートで対応付ける。 */
export type DispenseWorkbenchPhase = 'dispense' | 'audit' | 'set' | 'set-audit';

/**
 * 工程キュー = その工程の「待ち＋作業中」の MedicationCycle.overall_status 集合（SSOT）。
 * 患者ごとの最新サイクルがこの集合に入る工程の左一覧にのみ表示される。
 * - dispense: 調剤待ち(ready_to_dispense)＋調剤中(dispensing)
 * - audit: 調剤完了で監査待ち(dispensed)＋監査中(audit_pending)
 * - set: 監査完了でセット待ち(audited)＋セット作業中(setting)
 * - set-audit: base status だけでは set と分離不可（setting/audited が重複）。
 *   セット完了かつセット監査未完の判定は SetBatch.audit_state 集計（後続スライス）に依存するため、
 *   ここでは **空集合 = ゲート**（base status フィルタでは set-audit 候補を返さない）。
 * 上流(intake_received/structuring/inquiry_*)・例外(on_hold/cancelled)はどの工程にも含めない。
 */
export const PHASE_CYCLE_STATUSES: Record<DispenseWorkbenchPhase, MedicationCycleStatus[]> = {
  dispense: ['ready_to_dispense', 'dispensing'],
  audit: ['dispensed', 'audit_pending'],
  set: ['audited', 'setting'],
  'set-audit': [],
};

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
  crush_prohibited: '粉砕不可',
  separate_pack: '別包',
  half_tablet: '半割',
};

const PACKAGING_METHOD_LABELS: Record<DispenseMedicationGroupMethod, string> = {
  none: '指定なし',
  unit_dose: '一包化',
  morning_evening_unit_dose: '朝夕別一包化',
  medication_box: 'お薬BOX',
  calendar_pack: 'カレンダーセット',
  blister_pack: 'ブリスター管理',
  crush_and_pack: '粉砕・混合',
  other: 'その他',
};

const PACKAGING_METHOD_VALUES = new Set(Object.keys(PACKAGING_METHOD_LABELS));

function normalizePackagingMethod(value: string | null): DispenseMedicationGroupMethod {
  if (value && PACKAGING_METHOD_VALUES.has(value)) {
    return value as DispenseMedicationGroupMethod;
  }
  if (value === 'crushed') return 'crush_and_pack';
  if (value === 'standard') return 'none';
  return 'none';
}

function inferGroupMethod(rows: WorkbenchCountRow[]): DispenseMedicationGroupMethod {
  const explicit = rows
    .map((row) => normalizePackagingMethod(row.packaging_method ?? row.dispensing_method))
    .find((method) => method !== 'none');
  if (explicit) return explicit;
  if (rows.some((row) => row.tags.includes('unit_dose'))) return 'unit_dose';
  return 'unit_dose';
}

export function getDispenseMedicationGroupMethodLabel(method: DispenseMedicationGroupMethod) {
  return PACKAGING_METHOD_LABELS[method];
}

const MEDICATION_DOSE_SLOT_LABELS: Record<MedicationDoseSlotKey, string> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
};

const MEDICATION_DOSE_SLOT_KEYS: MedicationDoseSlotKey[] = [
  'morning',
  'noon',
  'evening',
  'bedtime',
];

const MEDICATION_GROUP_PRESENTATION: Record<
  MedicationFormatGroupKind,
  { label: string; description: string; sortOrder: number }
> = {
  unit_dose: {
    label: '一包化',
    description: '氏名・日付・用法の印字対象。朝昼夕眠前の包を同じ行で確認します。',
    sortOrder: 10,
  },
  crush_and_pack: {
    label: '粉砕・混合',
    description: '粉砕、脱カプ、賦形など加工が必要な薬剤です。',
    sortOrder: 20,
  },
  separate_pack: {
    label: '別包',
    description: '薬品名や条件を分けて印字・確認する薬剤です。',
    sortOrder: 30,
  },
  do_not_package: {
    label: 'PTP・分包しない',
    description: '一包化から外し、PTPや個別管理で渡す薬剤です。',
    sortOrder: 40,
  },
  prn: {
    label: '頓用',
    description: '必要時のみ。定時包に混ぜない薬剤です。',
    sortOrder: 50,
  },
  non_internal: {
    label: '外用・注射・非内服',
    description: '内服包とは別管理。持参漏れと冷所管理を確認します。',
    sortOrder: 60,
  },
  other: {
    label: 'その他',
    description: '包装方法が未確定、または個別確認が必要な薬剤です。',
    sortOrder: 70,
  },
};

function compactLabels(labels: Array<string | null | undefined>): string[] {
  return [...new Set(labels.filter((label): label is string => Boolean(label?.trim())))];
}

function formatDoseNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3))).replace(/\.0+$/, '');
}

function buildDoseSlotText(
  row: WorkbenchCountRow,
  scheduledSlots: string[],
): { text: string; needsCheck: boolean } {
  if (row.prescribed_quantity == null || row.days == null || row.days <= 0) {
    return { text: '要確認', needsCheck: true };
  }
  if (scheduledSlots.length === 0) return { text: '—', needsCheck: false };
  const perDose = row.prescribed_quantity / row.days / scheduledSlots.length;
  if (!Number.isFinite(perDose) || perDose <= 0) {
    return { text: '要確認', needsCheck: true };
  }
  const rounded = Number(perDose.toFixed(3));
  const needsCheck = Math.abs(perDose - rounded) > Number.EPSILON;
  return { text: `${formatDoseNumber(rounded)}${row.unit}`, needsCheck };
}

function includesInstruction(row: WorkbenchCountRow, pattern: RegExp): boolean {
  return pattern.test(row.packaging_instructions ?? '') || pattern.test(row.packaging_method ?? '');
}

function classifyMedicationFormatGroup(row: WorkbenchCountRow): MedicationFormatGroupKind {
  const frequencySlots = parseFrequencyToSlots(row.frequency);
  if (row.route && !['internal', 'oral', '内服'].includes(row.route)) return 'non_internal';
  if (frequencySlots.includes('prn')) return 'prn';
  if (
    row.packaging_method === 'crush_and_pack' ||
    row.packaging_method === 'crushed' ||
    includesInstruction(row, /粉砕|脱カプ|賦形|混合/)
  ) {
    return 'crush_and_pack';
  }
  if (row.tags.includes('separate_pack') || includesInstruction(row, /別包/))
    return 'separate_pack';
  if (
    row.packaging_method === 'blister_pack' ||
    includesInstruction(row, /PTP|分包しない|ヒート|シート/)
  ) {
    return 'do_not_package';
  }
  if (
    row.tags.includes('unit_dose') ||
    row.packaging_method === 'unit_dose' ||
    row.packaging_method == null
  ) {
    return 'unit_dose';
  }
  return 'other';
}

function buildMedicationFormatLine(row: WorkbenchCountRow): MedicationFormatLine {
  const rawSlots = parseFrequencyToSlots(row.frequency);
  const scheduledSlots = rawSlots.filter((slot): slot is MedicationDoseSlotKey =>
    MEDICATION_DOSE_SLOT_KEYS.includes(slot as MedicationDoseSlotKey),
  );
  const doseSlot = buildDoseSlotText(row, scheduledSlots);
  const slots = Object.fromEntries(
    MEDICATION_DOSE_SLOT_KEYS.map((key) => [
      key,
      {
        key,
        label: MEDICATION_DOSE_SLOT_LABELS[key],
        text: scheduledSlots.includes(key) ? doseSlot.text : '—',
        status: scheduledSlots.includes(key)
          ? doseSlot.needsCheck
            ? 'needs_check'
            : 'scheduled'
          : 'none',
      } satisfies MedicationFormatDoseSlot,
    ]),
  ) as Record<MedicationDoseSlotKey, MedicationFormatDoseSlot>;

  const processingLabels = compactLabels([
    row.tags.includes('unit_dose') || row.packaging_method === 'unit_dose' ? '一包化' : null,
    includesInstruction(row, /粉砕/) || row.packaging_method === 'crush_and_pack' ? '粉砕' : null,
    includesInstruction(row, /脱カプ/) ? '脱カプ' : null,
    includesInstruction(row, /賦形/) ? '賦形' : null,
    row.tags.includes('half_tablet') || includesInstruction(row, /半割|0\.5/) ? '半割' : null,
    row.tags.includes('separate_pack') || includesInstruction(row, /別包/) ? '別包' : null,
    row.packaging_method === 'blister_pack' || includesInstruction(row, /PTP|分包しない/)
      ? 'PTP・分包しない'
      : null,
  ]);
  const cautionLabels = compactLabels(
    row.tags.map((tag) => HANDLING_TAG_LABELS[tag] ?? null).concat(row.is_narcotic ? ['麻薬'] : []),
  );
  const notes = compactLabels([
    rawSlots.includes('prn') ? '頓用・必要時' : null,
    doseSlot.needsCheck ? '時点量を処方原本で確認' : null,
    row.packaging_instructions,
    row.packaging_group_id ? `包装グループ ${row.packaging_group_id}` : null,
  ]);

  return {
    lineId: row.line_id,
    lineNumber: row.line_number,
    drugName: row.drug_name,
    usage: row.frequency || '用法未登録',
    doseText: row.dose,
    days: row.days,
    quantityLabel: row.prescribed_label,
    dispensedLabel: row.dispensed_label,
    unit: row.unit,
    slots,
    processingLabels,
    cautionLabels,
    notes,
    statusLabel:
      row.prescribed_quantity == null
        ? '数量未確定'
        : row.dispensed_quantity == null
          ? '未調剤'
          : '調剤済',
  };
}

export function buildMedicationFormatGroups(rows: WorkbenchCountRow[]): MedicationFormatGroup[] {
  const grouped = new Map<MedicationFormatGroupKind, MedicationFormatLine[]>();
  for (const row of rows) {
    const kind = classifyMedicationFormatGroup(row);
    const lines = grouped.get(kind) ?? [];
    lines.push(buildMedicationFormatLine(row));
    grouped.set(kind, lines);
  }

  return Array.from(grouped.entries())
    .map(([kind, lines]) => {
      const presentation = MEDICATION_GROUP_PRESENTATION[kind];
      return {
        id: kind,
        kind,
        label: presentation.label,
        description: presentation.description,
        sortOrder: presentation.sortOrder,
        lines: lines.sort((left, right) => {
          if (left.lineNumber != null && right.lineNumber != null)
            return left.lineNumber - right.lineNumber;
          return left.drugName.localeCompare(right.drugName, 'ja');
        }),
      };
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function buildDispenseMedicationGroups(
  rows: WorkbenchCountRow[],
): DispenseMedicationGroup[] {
  const rowById = new Map(rows.map((row) => [row.line_id, row]));
  const assignments = generatePackagingGroups(
    rows.map((row) => ({
      id: row.line_id,
      drug_name: row.drug_name,
      frequency: row.frequency,
      route: row.route,
      packaging_instruction_tags: row.tags,
    })),
  );

  const grouped = new Map<
    string,
    {
      label: string;
      slot: string | null;
      rows: WorkbenchCountRow[];
      crushProhibitedCount: number;
    }
  >();

  for (const assignment of assignments) {
    if (!assignment.groupId) continue;
    const row = rowById.get(assignment.lineId);
    if (!row) continue;
    const existing = grouped.get(assignment.groupId);
    if (existing) {
      if (!existing.rows.some((candidate) => candidate.line_id === row.line_id)) {
        existing.rows.push(row);
      }
      existing.crushProhibitedCount += assignment.isCrushProhibited ? 1 : 0;
    } else {
      grouped.set(assignment.groupId, {
        label: assignment.groupLabel,
        slot: assignment.slot,
        rows: [row],
        crushProhibitedCount: assignment.isCrushProhibited ? 1 : 0,
      });
    }
  }

  return Array.from(grouped.entries()).map(([id, group]) => {
    const method = inferGroupMethod(group.rows);
    const cautionLabels = [
      ...new Set(
        group.rows.flatMap((row) =>
          row.tags
            .map((tag) => HANDLING_TAG_LABELS[tag] ?? null)
            .filter((label): label is string => label != null),
        ),
      ),
    ];
    return {
      id,
      label: group.label,
      slot: group.slot,
      method,
      methodLabel: PACKAGING_METHOD_LABELS[method],
      lineIds: group.rows.map((row) => row.line_id),
      lineNames: group.rows.map((row) => row.drug_name),
      crushProhibitedCount: group.crushProhibitedCount,
      cautionLabels,
    };
  });
}

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
