/**
 * 調剤ワークベンチ 実データ → model 純関数マッピング（計画 §4 アダプタ境界 / §11 / §14）
 *
 * 1a で実装済みの読取 API レスポンス（dispense-workbench.shared.ts の公開型）を、
 * ワークベンチ基盤の安定契約型（dispensing-workbench.types.ts の SeedPatient / Group / Drug）
 * へ写像する。**副作用なし・fetch なし**（テスト容易性のための純関数集）。
 *
 * 段階1b スコープは dispense / audit 工程の読取のみ。書込（楽観更新 / 競合 / 保留）と
 * set / seta（カレンダー）は対象外。time-point 数量（朝昼夕眠前）は count_row に直接無いため、
 * shared.ts と同じ "1日量 ÷ days ÷ 時点数" の逆算で割り付ける（端数は要確認扱い）。
 *
 * SeedPatient の age / dob / sex / yosei など実データ供給源が無いフィールドは
 * 安全なプレースホルダで埋める（既存 view ロジックが落ちないことを優先）。
 */

import { parseFrequencyToSlots } from '@/lib/dispensing/packaging-group';
import type {
  DispenseWorkbenchData,
  DispenseWorkbenchPatientRow,
  WorkbenchComparisonRow,
  WorkbenchCountRow,
  WorkbenchPackagingGroup,
} from '@/app/(dashboard)/dispense/dispense-workbench.shared';

import type {
  ChangeKind,
  DiscontinuedMed,
  Drug,
  Group,
  GroupPeriodWarning,
  HoldInfo,
  SeedChange,
  SeedPatient,
  WorkbenchModel,
} from './dispensing-workbench.types';
import {
  HOLD_REASON_TO_CODE,
  NG_LABEL_TO_CODE,
  SLOT_TO_TIMING,
  type CalendarMatrixResponse,
  type CellMeta,
  type PrescriptionLineMeta,
} from './dispensing-workbench.write-types';
import { cellKey } from './dispensing-workbench.logic';

// ── 内部ユーティリティ ──

/** 'yyyy-MM-dd' → 'YYYY/MM/DD'（view は regist をこの形式で扱う）。null/空は ''。 */
function toSlashDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.replace(/-/g, '/');
}

/** 名前の先頭 1 文字（アバター頭文字）。空なら '?'。 */
function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? Array.from(trimmed)[0] : '?';
}

const UNGROUPED_GROUP_KEY = '__ungrouped__';

function packagingGroupsOf(data: DispenseWorkbenchData): WorkbenchPackagingGroup[] {
  return data.packaging_groups ?? [];
}

function packagingGroupMetaById(data: DispenseWorkbenchData): Map<string, WorkbenchPackagingGroup> {
  return new Map(packagingGroupsOf(data).map((group) => [group.id, group]));
}

function periodKeyOf(row: WorkbenchCountRow) {
  return [row.start_date ?? '', row.end_date ?? '', row.days ?? ''].join('|');
}

function periodLabelOf(row: WorkbenchCountRow) {
  const start = row.start_date ?? '開始日未設定';
  const end = row.end_date ?? '終了日未設定';
  const days = row.days != null ? `${row.days}日` : '日数未設定';
  return `${start}〜${end} ${days}`;
}

function groupPeriodWarning(rows: WorkbenchCountRow[]): GroupPeriodWarning | undefined {
  const periods = new Map<string, string>();
  for (const row of rows) {
    periods.set(periodKeyOf(row), periodLabelOf(row));
  }
  if (periods.size <= 1) return undefined;
  const labels = Array.from(periods.values());
  const preview = labels.slice(0, 3).join(' / ');
  const omitted = labels.length > 3 ? ` / 他${labels.length - 3}種類` : '';
  return {
    kind: 'mixed_period',
    label: `期間混在 ${labels.length}種類`,
    detail: `${preview}${omitted}`,
  };
}

function workbenchGroupOrder(data: DispenseWorkbenchData): string[] {
  const groupOrder: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    groupOrder.push(key);
  };
  for (const group of packagingGroupsOf(data)) add(group.id);
  for (const row of data.count_rows) add(row.packaging_group_id ?? UNGROUPED_GROUP_KEY);
  return groupOrder;
}

/** 時点キー（packaging-group の slot）→ SeedDrug の a/h/y/n のどれに載せるか。 */
const SLOT_LABELS: Record<string, '朝' | '昼' | '夕' | '眠前'> = {
  morning: '朝',
  noon: '昼',
  evening: '夕',
  bedtime: '眠前',
};

const HOLD_CODE_TO_REASON = Object.fromEntries(
  Object.entries(HOLD_REASON_TO_CODE).map(([label, code]) => [code, label]),
);

const NG_CODE_TO_LABEL = Object.fromEntries(
  Object.entries(NG_LABEL_TO_CODE).map(([label, code]) => [code, label]),
);

/** 整数なら整数、そうでなければ小数 3 桁まで（末尾 0 除去）。 */
function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3))).replace(/\.?0+$/, '');
}

/**
 * count_row の "1日量 ÷ days ÷ 時点数" を朝昼夕眠前へ割り付ける。
 * 時点別の実数量は API に無いため逆算。単位 g は数量に付与（錠は無印）。
 * 算出不能（数量 / days 不明、頓用のみ等）は全 '' を返し、view 側で計数空欄になる。
 */
function computeSlotQuantities(row: WorkbenchCountRow): {
  a: string;
  h: string;
  y: string;
  n: string;
} {
  const empty = { a: '', h: '', y: '', n: '' };
  const slots = parseFrequencyToSlots(row.frequency).filter((s) => s in SLOT_LABELS);
  if (slots.length === 0) return empty;
  if (row.prescribed_quantity == null || row.days == null || row.days <= 0) return empty;
  const perDose = row.prescribed_quantity / row.days / slots.length;
  if (!Number.isFinite(perDose) || perDose <= 0) return empty;
  const unit = row.unit === 'g' || row.unit === 'mL' || row.unit === 'ml' ? row.unit : '';
  const text = `${formatQuantity(Number(perDose.toFixed(3)))}${unit}`;
  const out = { ...empty };
  for (const slot of slots) {
    const label = SLOT_LABELS[slot];
    if (label === '朝') out.a = text;
    else if (label === '昼') out.h = text;
    else if (label === '夕') out.y = text;
    else if (label === '眠前') out.n = text;
  }
  return out;
}

/** count_row の行タグ（'頓用' / '外用' / ''）。 */
function tagOf(row: WorkbenchCountRow): string {
  if (parseFrequencyToSlots(row.frequency).includes('prn')) return '頓用';
  if (row.route && !['internal', 'oral', '内服'].includes(row.route)) return '外用';
  return '';
}

/** 粉砕実施フラグ。crush_prohibited（粉砕不可）は逆意味なので使わない。 */
function funsaiOf(row: WorkbenchCountRow): boolean {
  if (row.packaging_method === 'crush_and_pack' || row.packaging_method === 'crushed') return true;
  return /粉砕|脱カプ/.test(row.packaging_instructions ?? '');
}

/**
 * 備考・賦形（note）。view / logic 側の正規表現（/賦形|別包|PTP|要|残薬|平日/ 等）が反応する
 * 文字列をそのまま載せる。packaging_instructions を主体に、麻薬/別包タグを補う。
 */
function noteOf(row: WorkbenchCountRow): string {
  const parts: string[] = [];
  if (row.packaging_instructions) parts.push(row.packaging_instructions);
  if (row.tags.includes('separate_pack') && !/別包/.test(parts.join(''))) parts.push('別包');
  return parts.join(' ・ ');
}

/** comparison 行の change_type → SeedDrug の chg（'new' / 'changed' / undefined）。 */
function changeKindOf(changeType: WorkbenchComparisonRow['change_type']): ChangeKind | undefined {
  if (changeType === 'added') return 'new';
  if (changeType === 'dose_changed' || changeType === 'frequency_changed') return 'changed';
  return undefined;
}

// ── 公開: 患者リスト写像 ──

/**
 * 患者リスト API 行 → SeedPatient（左ペイン / ソート / リボン用の部分埋め）。
 * rows は左ペインでは未使用のため空。age/dob/sex 等は供給源が無いためプレースホルダ。
 */
export function patientRowToSeed(row: DispenseWorkbenchPatientRow): SeedPatient {
  return {
    id: row.patient_id,
    name: row.name,
    kana: row.name_kana,
    dob: '—',
    age: 0,
    sex: '—',
    sub: '',
    short: initialOf(row.name),
    chips: [],
    regist: toSlashDate(row.registered_date),
    seedStart: row.start_date ?? '',
    seedDays: 0,
    yosei: '—',
    changes: [],
    biko: [],
    rows: [],
  };
}

/** 患者リスト API 全行 → SeedPatient[]。 */
export function patientsFromApi(rows: DispenseWorkbenchPatientRow[]): SeedPatient[] {
  return rows.map(patientRowToSeed);
}

// ── 公開: ワークベンチ（選択患者 1 名分）写像 ──

/**
 * DispenseWorkbenchData → { patient, groups }。
 * count_rows を packaging_group_id（無ければ単一グループ）でグループ化し Group[] を生成。
 * patient は workbench API の patient/intake/safety/comparison から SeedPatient を合成
 * （リボン詳細・比較・申し送りを実データ化）。buildModel は通さず直接 Group を組む。
 */
export function workbenchFromApi(data: DispenseWorkbenchData): {
  patient: SeedPatient;
  groups: Group[];
  done: Record<string, boolean>;
  audit: Record<string, boolean>;
  quantityConfirmedByDid: Record<string, boolean>;
} {
  // comparison: line_id（comparison.key）→ chg / prevText を引くマップ + 中止薬。
  // Legacy fallback by drug_name is used only when the name maps to exactly one comparison row.
  const changeByKey = new Map<string, WorkbenchComparisonRow>();
  const changeCandidatesByName = new Map<string, WorkbenchComparisonRow[]>();
  const discontinued: DiscontinuedMed[] = [];
  const changes: SeedChange[] = [];
  for (const cmp of data.comparison) {
    if (cmp.change_type == null) continue;
    if (cmp.change_type === 'removed') {
      discontinued.push({ name: cmp.drug_name, yoho: cmp.previous_label ?? '' });
      changes.push({ type: '中止', text: cmp.drug_name });
      continue;
    }
    changeByKey.set(cmp.key, cmp);
    const candidates = changeCandidatesByName.get(cmp.drug_name) ?? [];
    candidates.push(cmp);
    changeCandidatesByName.set(cmp.drug_name, candidates);
    if (cmp.change_type === 'added') {
      changes.push({ type: '追加', text: cmp.drug_name });
    } else {
      changes.push({
        type: '変更',
        text: `${cmp.drug_name}（${cmp.previous_label ?? '前回'} → ${cmp.current_label ?? '今回'}）`,
      });
    }
  }

  // count_rows → Drug（行順保持）
  const countRowsByName = new Map<string, number>();
  for (const row of data.count_rows) {
    countRowsByName.set(row.drug_name, (countRowsByName.get(row.drug_name) ?? 0) + 1);
  }
  const drugs: { row: WorkbenchCountRow; drug: Drug }[] = data.count_rows.map((row) => {
    const slots = computeSlotQuantities(row);
    const nameCandidates = changeCandidatesByName.get(row.drug_name) ?? [];
    const cmp =
      changeByKey.get(row.line_id) ??
      (nameCandidates.length === 1 && countRowsByName.get(row.drug_name) === 1
        ? nameCandidates[0]
        : null);
    const drug: Drug = {
      did: row.line_id,
      name: row.drug_name,
      yoho: row.frequency || '用法未登録',
      a: slots.a,
      h: slots.h,
      y: slots.y,
      n: slots.n,
      tag: tagOf(row),
      funsai: funsaiOf(row),
      note: noteOf(row),
      prescribedQuantity: row.prescribed_quantity,
      dispensedQuantity: row.dispensed_quantity,
      discrepancyReason: row.discrepancy_reason,
      isNarcotic: row.is_narcotic,
      unit: row.unit,
    };
    const chg = changeKindOf(cmp?.change_type ?? null);
    if (chg) {
      drug.chg = chg;
      if (chg === 'changed' && cmp?.previous_label) drug.prevText = cmp.previous_label;
    }
    return { row, drug };
  });

  // PackagingGroup 正本がある場合はその順序・ラベル・方法を優先し、未知グループは行の出現順で補う。
  const groupOrder = workbenchGroupOrder(data);
  const groupMetaById = packagingGroupMetaById(data);
  const groupMap = new Map<string, Drug[]>();
  const groupRows = new Map<string, WorkbenchCountRow[]>();
  for (const key of groupOrder) {
    groupMap.set(key, []);
    groupRows.set(key, []);
  }
  for (const { row, drug } of drugs) {
    const key = row.packaging_group_id ?? UNGROUPED_GROUP_KEY;
    groupMap.get(key)!.push(drug);
    groupRows.get(key)!.push(row);
  }

  const seedStart = data.intake ? data.intake.prescribed_date : '';
  const groups: Group[] = groupOrder.map((key, idx) => {
    const meta = key === UNGROUPED_GROUP_KEY ? null : groupMetaById.get(key);
    const rows = groupRows.get(key) ?? [];
    const start = rows.find((row) => row.start_date)?.start_date ?? seedStart;
    return {
      gid: `${data.task.id}-g${idx}`,
      label: key === UNGROUPED_GROUP_KEY ? '定期薬' : meta?.label.trim() || `グループ ${idx + 1}`,
      method: meta?.method.trim() || '一包化',
      start,
      days: rows.find((row) => row.days != null)?.days ?? 0,
      periodWarning: groupPeriodWarning(rows),
      drugs: groupMap.get(key) ?? [],
    };
  });
  const done = Object.fromEntries(
    data.count_rows
      .filter((row) => row.result_id || row.dispensed_at)
      .map((row) => [row.line_id, true]),
  );
  const quantityConfirmedByDid = Object.fromEntries(
    data.count_rows
      .filter((row) => row.result_id || row.dispensed_quantity != null)
      .map((row) => [row.line_id, true]),
  );

  // 申し送り・属性チップ（HANDLING_TAG ラベルは API 側で日本語合成済みの safety.cautions を使用）
  const chips = [...new Set(data.safety.handling_tags)].filter((t) => t.length > 0);

  const patient: SeedPatient = {
    id: data.patient.id,
    name: data.patient.name,
    kana: '',
    dob: '—',
    age: 0,
    sex: '—',
    sub: '',
    short: initialOf(data.patient.name),
    chips,
    regist: data.intake ? toSlashDate(data.intake.prescribed_date) : '',
    seedStart,
    seedDays: 0,
    yosei: '—',
    changes,
    biko: data.safety.cautions,
    discontinued: discontinued.length > 0 ? discontinued : undefined,
    rows: [],
  };

  return { patient, groups, done, audit: {}, quantityConfirmedByDid };
}

// ── 公開: 書込結線の実データ識別子（writeContext の dispense/audit 部分） ──

/**
 * DispenseWorkbenchData → writeContext の dispense/audit 部分。
 * 安定契約（{patient, groups}）には触れず、書込で必要な id 束だけを別関数で抽出する。
 *
 * - taskId / cycleId / cycleVersion: 完了 / 保留 / 監査 の OCC・スコープ解決に使用。
 * - lineGroupByDid: line_id → packaging_group_id（グループ割当の現在値・差分判定用）。
 * - groupIdByGid: workbenchFromApi と同じ規則で組む gid → packaging_group_id。
 *   `__ungrouped__`（割当なし）は除外する（PackagingGroup.id を持たないため）。
 */
export function writeContextFromApi(data: DispenseWorkbenchData): {
  taskId: string;
  cycleId: string;
  cycleVersion: number;
  lineGroupByDid: Record<string, string | null>;
  lineMetaByDid: Record<string, PrescriptionLineMeta>;
  groupIdByGid: Record<string, string>;
  groupVersionByGid: Record<string, number>;
} {
  const lineGroupByDid: Record<string, string | null> = {};
  const lineMetaByDid: Record<string, PrescriptionLineMeta> = {};
  for (const row of data.count_rows) {
    lineGroupByDid[row.line_id] = row.packaging_group_id ?? null;
    lineMetaByDid[row.line_id] = {
      updatedAt: row.line_updated_at,
      startDate: row.start_date,
      endDate: row.end_date,
      days: row.days,
    };
  }

  // workbenchFromApi の groupOrder と同じ規則で gid を再構成する。
  const groupOrder = workbenchGroupOrder(data);
  const groupMetaById = packagingGroupMetaById(data);
  const groupIdByGid: Record<string, string> = {};
  const groupVersionByGid: Record<string, number> = {};
  groupOrder.forEach((key, idx) => {
    if (key === UNGROUPED_GROUP_KEY) return;
    const gid = `${data.task.id}-g${idx}`;
    groupIdByGid[gid] = key;
    const version = groupMetaById.get(key)?.version;
    if (version !== undefined) groupVersionByGid[gid] = version;
  });

  return {
    taskId: data.task.id,
    cycleId: data.cycle.id,
    cycleVersion: data.cycle.version,
    lineGroupByDid,
    lineMetaByDid,
    groupIdByGid,
    groupVersionByGid,
  };
}

// ── 公開: カレンダー → cellMeta（set/seta 書込の batch_id / version アンカー） ──

/**
 * CalendarMatrixResponse → cellMeta（cellKey '{患者id}:{di}:{tk}' → CellMeta）。
 *
 * store / view のセルキーは 0 始まりの di と時点キー（朝/昼/夕/眠前）。API は 1 始まりの
 * day_number と slot（morning/noon/evening/bedtime/prn）。di = day_number - 1、
 * tk = SLOT_TO_TIMING[slot] で対応づける（朝昼夕眠前のみ。prn 等はカレンダーセル外のため除外）。
 * 同一セルに複数 line（rows）の batch がぶら下がるため batchIds / versions は配列で集約する
 * （cell mutation / bulk-set の OCC アンカー）。batch_id が null（未生成）のセルは登録しない。
 */
export function cellMetaFromCalendar(
  patientId: string,
  matrix: CalendarMatrixResponse,
): Record<string, CellMeta> {
  const out: Record<string, CellMeta> = {};
  for (const row of matrix.rows) {
    for (const day of row.days) {
      for (const slot of Object.keys(day.cells)) {
        const tk = SLOT_TO_TIMING[slot];
        if (!tk) continue; // prn 等はカレンダーセル（朝昼夕眠前）外
        const cell = day.cells[slot as keyof typeof day.cells];
        if (!cell || cell.batch_id == null) continue;
        const di = day.day_number - 1;
        const key = `${patientId}:${di}:${tk}`;
        const existing = out[key];
        if (existing) {
          existing.batchIds.push(cell.batch_id);
          existing.versions.push(cell.version ?? 0);
        } else {
          out[key] = {
            batchIds: [cell.batch_id],
            versions: [cell.version ?? 0],
            dayNumber: day.day_number,
            slot,
          };
        }
      }
    }
  }
  return out;
}

function formatCalendarQuantity(value: number | null | undefined) {
  if (value == null || value === 0) return '';
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(3))).replace(/\.?0+$/, '');
}

function quantityForSlot(row: CalendarMatrixResponse['rows'][number], slot: string) {
  const firstQuantity = row.days
    .map((day) => day.cells[slot as keyof typeof day.cells]?.quantity)
    .find((value): value is number => value != null && value > 0);
  return formatCalendarQuantity(firstQuantity);
}

function calendarLineTagOf(line: CalendarMatrixResponse['rows'][number]['line']): string {
  const slots = parseFrequencyToSlots(line.frequency);
  if (slots.includes('prn')) return '頓用';
  if (line.route && line.route !== 'internal' && line.route !== 'oral' && line.route !== '内服') {
    return '外用';
  }
  return '';
}

function calendarLineNoteOf(line: CalendarMatrixResponse['rows'][number]['line']): string {
  const tags = line.packaging_instruction_tags ?? [];
  const parts = [
    line.dose ?? '',
    line.packaging_instructions ?? '',
    line.notes ?? '',
    tags.includes('cold_storage') ? '冷所' : '',
    tags.includes('separate_pack') ? '別包' : '',
    line.route === 'injection' ? '注射' : '',
    /液|mL|ml/.test(`${line.dosage_form ?? ''} ${line.unit ?? ''}`) ? '液剤' : '',
  ].filter((value) => value.trim().length > 0);

  return Array.from(new Set(parts)).join(' ・ ');
}

/**
 * CalendarMatrixResponse → existing workbench view state.
 *
 * /set and /set-audit still render from the stable workbench contract
 * (model + setCells/auditCells). This mapper makes the API calendar the source of
 * truth without changing the visual component contract.
 */
export function calendarWorkbenchStateFromApi(
  patientId: string,
  matrix: CalendarMatrixResponse,
): {
  model: WorkbenchModel;
  setCells: Record<string, string>;
  auditCells: Record<string, string>;
  ng: Record<string, string>;
  holdInfo: Record<string, HoldInfo>;
} {
  const narcoticClassification = matrix.narcotic_classification ?? {
    unresolved_line_count: 0,
    status: 'normal' as const,
  };
  const group: Group = {
    gid: `${patientId}-set-g0`,
    label: 'セット対象',
    method: matrix.set_method,
    start: matrix.period_start,
    days: matrix.day_count,
    calendarStart: matrix.period_start,
    calendarDayCount: matrix.day_count,
    narcoticClassification: {
      unresolvedLineCount: narcoticClassification.unresolved_line_count,
      status: narcoticClassification.status,
    },
    drugs: matrix.rows.map((row) => ({
      did: row.line.id,
      name: row.line.drug_name,
      yoho: row.line.frequency,
      a: quantityForSlot(row, 'morning'),
      h: quantityForSlot(row, 'noon'),
      y: quantityForSlot(row, 'evening'),
      n: quantityForSlot(row, 'bedtime'),
      tag: calendarLineTagOf(row.line),
      funsai: false,
      note: calendarLineNoteOf(row.line),
    })),
  };
  const setCells: Record<string, string> = {};
  const auditCells: Record<string, string> = {};
  const ng: Record<string, string> = {};
  const holdInfo: Record<string, HoldInfo> = {};

  for (const row of matrix.rows) {
    for (const day of row.days) {
      for (const slot of Object.keys(day.cells)) {
        const tk = SLOT_TO_TIMING[slot];
        if (!tk) continue;
        const cell = day.cells[slot as keyof typeof day.cells];
        if (!cell?.batch_id) continue;
        const key = cellKey(patientId, day.day_number - 1, tk);
        if (cell.set_state === 'hold') {
          setCells[key] = 'hold';
          if (cell.held_reason) {
            holdInfo[key] = {
              reason: HOLD_CODE_TO_REASON[cell.held_reason] ?? cell.held_reason,
              due: '',
              owner: '',
              memo: '',
            };
          }
        } else if (cell.set_state === 'set') {
          setCells[key] = 'set';
        }

        if (cell.audit_state === 'ok') auditCells[key] = 'ok';
        else if (cell.audit_state === 'ng') {
          auditCells[key] = 'ng';
          if (cell.ng_code && NG_CODE_TO_LABEL[cell.ng_code]) {
            ng[key] = NG_CODE_TO_LABEL[cell.ng_code];
          }
        } else if (cell.set_state === 'hold') auditCells[key] = 'hold';
      }
    }
  }

  return { model: { [patientId]: [group] }, setCells, auditCells, ng, holdInfo };
}
