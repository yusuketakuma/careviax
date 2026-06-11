import type {
  SetRowStatusKey,
  SetSlotKey,
  SetSlotMark,
} from '@/app/(dashboard)/medication-sets/set-workspace.shared';

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
  const dayCount = Math.max(
    1,
    Math.round(
      (startOfDay(plan.target_period_end).getTime() -
        startOfDay(plan.target_period_start).getTime()) /
        86_400_000,
    ) + 1,
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

/** 行状態: 承認済=完了 / 全スロット充足=数量確認中 / 一部=進行中 / 未着手=着手前 */
export function deriveRowStatus(plan: DerivablePlan | null): SetRowStatusKey {
  if (!plan) return 'waiting';
  if (plan.audits[0]?.result === 'approved') return 'completed';
  if (plan.batches.length === 0) return 'waiting';
  const marks = deriveSlotMarks(plan);
  const activeMarks = SET_SLOT_KEYS.map((slot) => marks[slot]).filter((mark) => mark !== 'none');
  if (activeMarks.length > 0 && activeMarks.every((mark) => mark === 'set')) {
    return 'quantity_check';
  }
  return 'in_progress';
}
