import { describe, expect, it } from 'vitest';
import {
  buildChangeBadge,
  buildDispenseQueueSubline,
  buildPausedLabel,
  canApproveCounts,
  familyName,
  findNextCountTarget,
  formatAgeMinutesLabel,
  formatDueTime,
  formatRemainingLabel,
  judgeCountRow,
  type WorkbenchCountRow,
} from './dispense-workbench.shared';

function countRow(overrides: Partial<WorkbenchCountRow> = {}): WorkbenchCountRow {
  return {
    line_id: 'line_1',
    result_id: 'result_1',
    drug_name: 'オキシコドン 5mg',
    tags: ['narcotic'],
    is_narcotic: true,
    prescribed_label: '14錠',
    prescribed_quantity: 14,
    dispensed_label: '14錠',
    dispensed_quantity: 14,
    unit: '錠',
    ...overrides,
  };
}

describe('dispense-workbench.shared', () => {
  it('familyName は空白区切りの姓を返す', () => {
    expect(familyName('佐藤 花子')).toBe('佐藤');
    expect(familyName('山田')).toBe('山田');
  });

  it('formatDueTime は HH:mm を返す', () => {
    expect(formatDueTime('2026-06-11T12:00:00')).toBe('12:00');
    expect(formatDueTime(null)).toBeNull();
  });

  it('formatRemainingLabel は「あとX時間Y分」を返す', () => {
    const now = new Date('2026-06-11T09:42:00');
    expect(formatRemainingLabel('2026-06-11T12:00:00', now)).toBe('あと2時間18分');
    expect(formatRemainingLabel('2026-06-11T10:00:00', now)).toBe('あと18分');
    expect(formatRemainingLabel('2026-06-11T09:00:00', now)).toBe('超過42分');
  });

  it('buildPausedLabel は「2時間止まっていた件 — 09:31に解除」形式を返す', () => {
    expect(buildPausedLabel('2026-06-11T07:31:00', '2026-06-11T09:31:00')).toBe(
      '2時間止まっていた件 — 09:31に解除',
    );
    expect(buildPausedLabel('2026-06-11T09:01:00', '2026-06-11T09:31:00')).toBe(
      '30分止まっていた件 — 09:31に解除',
    );
    expect(buildPausedLabel('2026-06-11T07:31:00', null)).toBeNull();
  });

  it('buildDispenseQueueSubline は照会再開と定期を区別する', () => {
    expect(
      buildDispenseQueueSubline({ overallStatus: 'inquiry_resolved', hasInquiryChange: true }),
    ).toBe('照会回答の反映 — 用量変更あり');
    expect(buildDispenseQueueSubline({ overallStatus: 'inquiry_resolved' })).toBe('照会回答の反映');
    expect(buildDispenseQueueSubline({ overallStatus: 'ready_to_dispense' })).toBe('定期・変更なし');
  });

  it('buildChangeBadge は減量/増量/新規/中止を返す', () => {
    expect(buildChangeBadge({ change_type: 'dose_changed', direction: 'decrease' })).toEqual({
      label: '減量',
      tone: 'amber',
    });
    expect(buildChangeBadge({ change_type: 'dose_changed', direction: 'increase' })?.label).toBe(
      '増量',
    );
    expect(buildChangeBadge({ change_type: 'added', direction: null })?.label).toBe('新規');
    expect(buildChangeBadge({ change_type: 'removed', direction: null })?.label).toBe('中止');
    expect(buildChangeBadge({ change_type: null, direction: null })).toBeNull();
  });

  it('formatAgeMinutesLabel は日/時間/分に丸める', () => {
    expect(formatAgeMinutesLabel(1500)).toBe('1日');
    expect(formatAgeMinutesLabel(120)).toBe('2時間');
    expect(formatAgeMinutesLabel(30)).toBe('30分');
  });

  it('judgeCountRow は 3 値一致のみ「一致」', () => {
    expect(judgeCountRow(14, 14, 14)).toBe('match');
    expect(judgeCountRow(14, 14, 13)).toBe('mismatch');
    expect(judgeCountRow(14, 14, null)).toBe('pending');
    expect(judgeCountRow(null, 14, 14)).toBe('pending');
  });

  it('canApproveCounts は全行一致(差異ゼロ)のときだけ true', () => {
    const rows = [countRow(), countRow({ line_id: 'line_2', dispensed_quantity: 28 })];
    expect(
      canApproveCounts(rows, {
        line_1: { first: 14, second: 14 },
        line_2: { first: 28, second: 28 },
      }),
    ).toBe(true);
    expect(
      canApproveCounts(rows, {
        line_1: { first: 14, second: null },
        line_2: { first: 28, second: 28 },
      }),
    ).toBe(false);
    expect(canApproveCounts([], {})).toBe(false);
  });

  it('findNextCountTarget は麻薬行を優先して未入力スロットを返す', () => {
    const rows = [
      countRow({ line_id: 'line_plain', is_narcotic: false, tags: [] }),
      countRow({ line_id: 'line_narc' }),
    ];
    const first = findNextCountTarget(rows, {});
    expect(first).toMatchObject({ slot: 'first', row: { line_id: 'line_narc' } });

    const second = findNextCountTarget(rows, {
      line_narc: { first: 14, second: null },
      line_plain: { first: 14, second: 14 },
    });
    expect(second).toMatchObject({ slot: 'second', row: { line_id: 'line_narc' } });

    expect(
      findNextCountTarget(rows, {
        line_narc: { first: 14, second: 14 },
        line_plain: { first: 14, second: 14 },
      }),
    ).toBeNull();
  });
});
