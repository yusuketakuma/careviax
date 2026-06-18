import type {
  SetRowStatusKey,
  SetSlotKey,
  SetSlotMark,
} from '@/lib/dispensing/set-workspace-shared';
import { MAX_SET_PLAN_DAY_COUNT } from '@/lib/set-plan-period';

/**
 * new_09_set: SetPlan / SetBatch からの行状態・スロット充足の導出(純関数)。
 * route.ts から分離してテスト可能にしている(Next.js の route export 制約回避)。
 */

export const SET_SLOT_KEYS: SetSlotKey[] = ['morning', 'noon', 'evening'];

export type DerivablePlanBatch = {
  line_id: string;
  slot: string;
  day_number: number;
  packaging_instruction_tags_snapshot: string[];
};

export type DerivablePlan = {
  target_period_start: Date;
  target_period_end: Date;
  batches: DerivablePlanBatch[];
  audits: Array<{ result: string }>;
};

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** 朝/昼/夕 スロットの充足マーク(全日分=✓ / 一部=・ / なし=—) */
export function deriveSlotMarks(plan: DerivablePlan | null): Record<SetSlotKey, SetSlotMark> {
  const marks: Record<SetSlotKey, SetSlotMark> = {
    morning: 'none',
    noon: 'none',
    evening: 'none',
  };
  if (!plan) return marks;
  const dayCount = Math.min(
    MAX_SET_PLAN_DAY_COUNT,
    Math.max(
      1,
      Math.round(
        (startOfDay(plan.target_period_end).getTime() -
          startOfDay(plan.target_period_start).getTime()) /
          86_400_000,
      ) + 1,
    ),
  );
  for (const slot of SET_SLOT_KEYS) {
    const coveredDays = new Set(
      plan.batches.filter((batch) => batch.slot === slot).map((batch) => batch.day_number),
    );
    if (coveredDays.size === 0) continue;
    marks[slot] = coveredDays.size >= dayCount ? 'set' : 'partial';
  }
  return marks;
}

/** 行状態: 最新監査結果を優先し、未監査は全スロット充足=監査待ち / 一部=進行中 / 未着手=着手前 */
export function deriveRowStatus(plan: DerivablePlan | null): SetRowStatusKey {
  if (!plan) return 'waiting';
  const latestAuditResult = plan.audits[0]?.result;
  if (latestAuditResult === 'approved') return 'completed';
  if (latestAuditResult === 'partial_approved') return 'partial_approved';
  if (latestAuditResult === 'rejected') return 'rejected';
  if (plan.batches.length === 0) return 'waiting';
  const marks = deriveSlotMarks(plan);
  const activeMarks = SET_SLOT_KEYS.map((slot) => marks[slot]).filter((mark) => mark !== 'none');
  if (activeMarks.length > 0 && activeMarks.every((mark) => mark === 'set')) {
    return 'quantity_check';
  }
  return 'in_progress';
}

/* ------------------------------------------------------------------ *
 * カレンダー(7day × slot)マトリクス pivot — 純関数。
 * GET /api/set-plans/[id]/calendar が SetBatch フラット配列を
 * 7日×用法のセル状態マトリクス + completion_gate へ整形するために使用。
 * route から分離してテスト可能にする(Next.js route export 制約回避)。
 * ------------------------------------------------------------------ */

/** カレンダーで扱う用法スロット(列方向)。SetBatch.slot の値域に対応。 */
export const CALENDAR_SLOT_KEYS = ['morning', 'noon', 'evening', 'bedtime', 'prn'] as const;
export type CalendarSlotKey = (typeof CALENDAR_SLOT_KEYS)[number];

/** セル状態(SetCellState ∪ SetAuditCellState から導出する表示値)。 */
export type CalendarCellState = 'empty' | 'pending' | 'set' | 'hold' | 'ok' | 'ng';

/** pivot 入力: SetBatch の最小サブセット。 */
export type CalendarPivotBatch = {
  id: string;
  line_id: string;
  slot: string;
  day_number: number;
  quantity: number;
  carry_type: string;
  set_state: string;
  audit_state: string;
  ng_code: string | null;
  held_reason: string | null;
  version: number;
};

/** pivot 入力: 行(処方ライン)見出しの最小サブセット。 */
export type CalendarPivotLine = {
  id: string;
  drug_name: string;
  dosage_form?: string | null;
  dose: string | null;
  frequency: string;
  unit: string | null;
  route?: string | null;
  packaging_instructions?: string | null;
  packaging_instruction_tags?: string[];
  notes?: string | null;
};

export type CalendarCell = {
  /** 当該 line×day×slot の SetBatch.id。未生成セルは null。 */
  batch_id: string | null;
  state: CalendarCellState;
  quantity: number | null;
  carry_type: string | null;
  set_state: string | null;
  audit_state: string | null;
  ng_code: string | null;
  held_reason: string | null;
  version: number | null;
};

export type CalendarDay = {
  /** 1 始まりの通日。 */
  day_number: number;
  /** YYYY-MM-DD(対象期間開始からの相対日)。 */
  date: string;
  cells: Record<CalendarSlotKey, CalendarCell>;
};

export type CalendarRow = {
  line: CalendarPivotLine;
  days: CalendarDay[];
};

export type CalendarCompletionGate = {
  total_cells: number;
  set_cells: number;
  pending_cells: number;
  hold_cells: number;
  audited_ok_cells: number;
  audited_ng_cells: number;
  unaudited_cells: number;
  /** 保留を除く全セルがセット済(=セット工程の完了可否)。 */
  set_complete: boolean;
  /** 未監査=0 かつ NG=0(=セット監査の承認可否)。 */
  audit_complete: boolean;
};

export type CalendarMatrix = {
  period_start: string;
  period_end: string;
  day_count: number;
  slots: CalendarSlotKey[];
  rows: CalendarRow[];
  completion_gate: CalendarCompletionGate;
};

function isCalendarSlotKey(slot: string): slot is CalendarSlotKey {
  return (CALENDAR_SLOT_KEYS as readonly string[]).includes(slot);
}

function emptyCell(): CalendarCell {
  return {
    batch_id: null,
    state: 'empty',
    quantity: null,
    carry_type: null,
    set_state: null,
    audit_state: null,
    ng_code: null,
    held_reason: null,
    version: null,
  };
}

/** セット状態 + 監査状態から、セルの単一表示状態を導出。監査結果(ok/ng)を最優先。 */
export function deriveCalendarCellState(setState: string, auditState: string): CalendarCellState {
  if (auditState === 'ng') return 'ng';
  if (auditState === 'ok') return 'ok';
  if (setState === 'hold') return 'hold';
  if (setState === 'set') return 'set';
  return 'pending';
}

function formatDateFromStart(start: Date, offsetDays: number): string {
  const next = new Date(start);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + offsetDays);
  const year = next.getFullYear();
  const month = `${next.getMonth() + 1}`.padStart(2, '0');
  const day = `${next.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function diffInclusiveDays(start: Date, end: Date): number {
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  return Math.floor((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1;
}

/**
 * SetBatch フラット配列を 7day(または対象期間日数)× slot のマトリクスへ pivot し、
 * completion_gate(セット完了 / 監査完了の可否)を併せて算出する純関数。
 */
export function buildCalendarMatrix(args: {
  periodStart: Date;
  periodEnd: Date;
  lines: CalendarPivotLine[];
  batches: CalendarPivotBatch[];
}): CalendarMatrix {
  const { periodStart, periodEnd, lines, batches } = args;
  const dayCount = Math.min(
    MAX_SET_PLAN_DAY_COUNT,
    Math.max(1, diffInclusiveDays(periodStart, periodEnd)),
  );

  // line_id -> day_number -> slot -> batch の索引を構築。
  const batchIndex = new Map<string, Map<number, Map<CalendarSlotKey, CalendarPivotBatch>>>();
  for (const batch of batches) {
    if (!isCalendarSlotKey(batch.slot)) continue;
    let byDay = batchIndex.get(batch.line_id);
    if (!byDay) {
      byDay = new Map();
      batchIndex.set(batch.line_id, byDay);
    }
    let bySlot = byDay.get(batch.day_number);
    if (!bySlot) {
      bySlot = new Map();
      byDay.set(batch.day_number, bySlot);
    }
    bySlot.set(batch.slot, batch);
  }

  const gate: CalendarCompletionGate = {
    total_cells: 0,
    set_cells: 0,
    pending_cells: 0,
    hold_cells: 0,
    audited_ok_cells: 0,
    audited_ng_cells: 0,
    unaudited_cells: 0,
    set_complete: false,
    audit_complete: false,
  };

  const rows: CalendarRow[] = lines.map((line) => {
    const byDay = batchIndex.get(line.id);
    const days: CalendarDay[] = [];
    for (let day = 1; day <= dayCount; day++) {
      const bySlot = byDay?.get(day);
      const cells = {} as Record<CalendarSlotKey, CalendarCell>;
      for (const slot of CALENDAR_SLOT_KEYS) {
        const batch = bySlot?.get(slot);
        if (!batch) {
          cells[slot] = emptyCell();
          continue;
        }
        const state = deriveCalendarCellState(batch.set_state, batch.audit_state);
        cells[slot] = {
          batch_id: batch.id,
          state,
          quantity: batch.quantity,
          carry_type: batch.carry_type,
          set_state: batch.set_state,
          audit_state: batch.audit_state,
          ng_code: batch.ng_code,
          held_reason: batch.held_reason,
          version: batch.version,
        };

        // completion_gate 集計(実在セルのみ)。
        gate.total_cells += 1;
        if (batch.set_state === 'set') gate.set_cells += 1;
        else if (batch.set_state === 'hold') gate.hold_cells += 1;
        else gate.pending_cells += 1;
        if (batch.audit_state === 'ok') gate.audited_ok_cells += 1;
        else if (batch.audit_state === 'ng') gate.audited_ng_cells += 1;
        else gate.unaudited_cells += 1;
      }
      days.push({
        day_number: day,
        date: formatDateFromStart(periodStart, day - 1),
        cells,
      });
    }
    return { line, days };
  });

  // セット完了: 実在セルが1つ以上あり、保留を除く全セルがセット済。
  gate.set_complete = gate.total_cells > 0 && gate.pending_cells === 0;
  // 監査完了: 実在セルが1つ以上あり、未監査=0 かつ NG=0。
  gate.audit_complete =
    gate.total_cells > 0 && gate.unaudited_cells === 0 && gate.audited_ng_cells === 0;

  return {
    period_start: formatDateFromStart(periodStart, 0),
    period_end: formatDateFromStart(periodStart, dayCount - 1),
    day_count: dayCount,
    slots: [...CALENDAR_SLOT_KEYS],
    rows,
    completion_gate: gate,
  };
}
