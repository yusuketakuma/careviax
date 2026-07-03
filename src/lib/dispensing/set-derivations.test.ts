import { describe, expect, it } from 'vitest';

import {
  buildCalendarMatrix,
  deriveRowStatus,
  deriveSlotMarks,
  type DerivablePlanBatch,
} from '@/lib/dispensing/set-derivations';
import { countInclusiveDateKeys } from '@/lib/set-plan-period';

/**
 * WF-20260625-set-derivations-daycount-rounding の回帰テスト。
 *
 * かつて deriveSlotMarks は Math.round(localDiff)+1、buildCalendarMatrix は
 * Math.floor(localDiff)+1 と、ローカル startOfDay に対して丸め方向が食い違って
 * いた。UTC 0:00 で保存された target_period を実行時 TZ がサマータイム地域だと
 * spring-forward(23h 日)で両者が 1 日ずれ、floor 側(カレンダー/完了ゲート)が
 * 実期間より 1 日短く「完了」判定する false-completion を招いた。
 * 現在は両者とも UTC date-key ベースの単一 SSOT(countInclusiveDateKeys)で数える。
 */

// process.env.TZ を差し替え、内側でアサートして「非東京 TZ でも UTC 基準」を実証する。
function withTimezone(timezone: string, run: () => void) {
  const originalTimezone = process.env.TZ;
  process.env.TZ = timezone;
  try {
    run();
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
}

// target_period は作成時に new Date('YYYY-MM-DD') = UTC 0:00 で保存される。
function utcMidnight(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

// morning スロットを day 1..coveredDays まで充足させる batch 群。
function morningCoverage(coveredDays: number): DerivablePlanBatch[] {
  return Array.from({ length: coveredDays }, (_, i) => ({
    line_id: 'l1',
    slot: 'morning',
    day_number: i + 1,
    packaging_instruction_tags_snapshot: [],
  }));
}

function makePlan(startKey: string, endKey: string, batches: DerivablePlanBatch[]) {
  return {
    target_period_start: utcMidnight(startKey),
    target_period_end: utcMidnight(endKey),
    batches,
    audits: [] as Array<{ result: string }>,
  };
}

describe('inclusive day-count SSOT (rounding regression)', () => {
  it('deriveSlotMarks と buildCalendarMatrix の日数分母が一致する(月跨ぎ)', () => {
    // 6/29,6/30,7/1,7/2 = 4 日(月・DST いずれも跨がない基準ケース)。
    const startKey = '2026-06-29';
    const endKey = '2026-07-02';
    const expected = countInclusiveDateKeys(startKey, endKey);
    expect(expected).toBe(4);

    const matrix = buildCalendarMatrix({
      periodStart: utcMidnight(startKey),
      periodEnd: utcMidnight(endKey),
      lines: [],
      batches: [],
    });
    expect(matrix.day_count).toBe(expected);

    // 分母 = 4。4 日充足 → set(完了)、3 日 → partial(進行中)。
    expect(deriveSlotMarks(makePlan(startKey, endKey, morningCoverage(4))).morning).toBe('set');
    expect(deriveSlotMarks(makePlan(startKey, endKey, morningCoverage(3))).morning).toBe('partial');
  });

  it('月跨ぎ境界: 全スロット充足で監査待ち、1日不足で進行中', () => {
    const startKey = '2026-06-30';
    const endKey = '2026-07-01'; // 2 日
    expect(countInclusiveDateKeys(startKey, endKey)).toBe(2);

    const full: DerivablePlanBatch[] = [];
    for (const slot of ['morning', 'noon', 'evening']) {
      for (const day of [1, 2]) {
        full.push({
          line_id: 'l1',
          slot,
          day_number: day,
          packaging_instruction_tags_snapshot: [],
        });
      }
    }
    expect(deriveRowStatus(makePlan(startKey, endKey, full))).toBe('quantity_check');

    // 1 日分(day 2 evening)を落とすと evening が partial → in_progress。
    const short = full.filter((b) => !(b.slot === 'evening' && b.day_number === 2));
    expect(deriveRowStatus(makePlan(startKey, endKey, short))).toBe('in_progress');
  });

  it.each(['Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati', 'Etc/GMT+12'])(
    'DST/TZ 非依存: %s でも spring-forward を跨ぐ期間の日数が UTC 基準で一致',
    (timezone) => {
      withTimezone(timezone, () => {
        // 2026-03-06〜03-10。米国 spring-forward(03-08)を含む。UTC 基準では 5 日。
        // 旧 floor 実装は NY 実行時 4 日と過少計上していた(round 側は 5)。
        const startKey = '2026-03-06';
        const endKey = '2026-03-10';
        expect(countInclusiveDateKeys(startKey, endKey)).toBe(5);

        const matrix = buildCalendarMatrix({
          periodStart: utcMidnight(startKey),
          periodEnd: utcMidnight(endKey),
          lines: [],
          batches: [],
        });
        // floor 実装なら NY で 4 に落ちるが、UTC SSOT なので常に 5。
        expect(matrix.day_count).toBe(5);

        // 完了分母も同じく 5。4 日充足では完了させない(false-completion 防止)。
        expect(deriveSlotMarks(makePlan(startKey, endKey, morningCoverage(5))).morning).toBe('set');
        expect(deriveSlotMarks(makePlan(startKey, endKey, morningCoverage(4))).morning).toBe(
          'partial',
        );
      });
    },
  );

  it('端数日は発生しない: 単日期間は分母 1、1 日充足で set', () => {
    const key = '2026-07-01';
    expect(countInclusiveDateKeys(key, key)).toBe(1);
    const matrix = buildCalendarMatrix({
      periodStart: utcMidnight(key),
      periodEnd: utcMidnight(key),
      lines: [],
      batches: [],
    });
    expect(matrix.day_count).toBe(1);
    expect(deriveSlotMarks(makePlan(key, key, morningCoverage(1))).morning).toBe('set');
  });

  it('上限 35 日でクランプされる(過大期間の防御)', () => {
    const startKey = '2026-01-01';
    const endKey = '2026-12-31';
    const matrix = buildCalendarMatrix({
      periodStart: utcMidnight(startKey),
      periodEnd: utcMidnight(endKey),
      lines: [],
      batches: [],
    });
    expect(matrix.day_count).toBe(35);
    // deriveSlotMarks 側も 35 でクランプ: 35 日充足で set、34 日で partial。
    expect(deriveSlotMarks(makePlan(startKey, endKey, morningCoverage(35))).morning).toBe('set');
    expect(deriveSlotMarks(makePlan(startKey, endKey, morningCoverage(34))).morning).toBe(
      'partial',
    );
  });
});
