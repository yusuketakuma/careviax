import { describe, expect, it } from 'vitest';
import {
  buildChangeBadge,
  buildDispenseSafetySummary,
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
  type DispenseWorkbenchData,
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

function workbench(overrides: Partial<DispenseWorkbenchData> = {}): DispenseWorkbenchData {
  return {
    task: { id: 'task_1', status: 'pending', priority: 'normal', due_date: null },
    cycle: { id: 'cycle_1', overall_status: 'inquiry_resolved' },
    patient: { id: 'patient_1', name: '佐々木 ハル' },
    intake: { id: 'intake_1', prescribed_date: '2026-06-11' },
    previous_intake: { prescribed_date: '2026-05-14' },
    safety: {
      allergy: null,
      renal: null,
      handling_tags: ['cold_storage'],
      swallowing: null,
      cautions: [],
    },
    comparison: [
      {
        key: 'line_1',
        drug_name: 'ファモチジン',
        previous_label: '20mg 朝夕',
        current_label: '10mg 朝夕',
        change_type: 'dose_changed',
        direction: 'decrease',
        inquiry_origin: true,
      },
      {
        key: 'line_2',
        drug_name: 'マグミット',
        previous_label: '毎食後',
        current_label: '毎食後',
        change_type: null,
        direction: null,
        inquiry_origin: false,
      },
    ],
    count_rows: [countRow({ line_id: 'line_1', tags: ['narcotic'] })],
    dispenser: null,
    auditor: { id: 'user_1', name: '山田 花子' },
    is_self_audit: false,
    has_narcotic: true,
    visit_time_label: null,
    resolved_inquiry: null,
    team_audit_total: 0,
    stock_check_date_label: null,
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
    expect(buildDispenseQueueSubline({ overallStatus: 'ready_to_dispense' })).toBe(
      '定期・変更なし',
    );
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

  it('buildDispenseSafetySummary は変更・照会反映・数量未確定・取扱い注意を集約する', () => {
    expect(buildDispenseSafetySummary(workbench())).toEqual({
      changedCount: 1,
      inquiryChangeCount: 1,
      inquiryResponseNeedsCheck: true,
      unresolvedPrescriptionQuantityCount: 0,
      missingActualQuantityCount: 0,
      specialHandlingLabels: ['冷所', '麻薬'],
      nextCheckLabel: '照会回答の変更点を読み上げ確認',
    });

    expect(
      buildDispenseSafetySummary(
        workbench({
          count_rows: [countRow({ prescribed_quantity: null, tags: [] })],
          has_narcotic: false,
        }),
      ),
    ).toMatchObject({
      unresolvedPrescriptionQuantityCount: 1,
      missingActualQuantityCount: 0,
      specialHandlingLabels: ['冷所'],
      nextCheckLabel: '処方数量未確定を処方取込で確認',
    });

    expect(
      buildDispenseSafetySummary(
        workbench({
          comparison: [
            {
              key: 'line_1',
              drug_name: 'ファモチジン',
              previous_label: '20mg 朝夕',
              current_label: '10mg 朝夕',
              change_type: 'dose_changed',
              direction: 'decrease',
              inquiry_origin: false,
            },
          ],
          resolved_inquiry: {
            inquired_at: '2026-06-11T07:31:00',
            resolved_at: '2026-06-11T09:31:00',
            institution: 'やまもと内科',
            change_detail: '照会回答により減量',
          },
        }),
      ),
    ).toMatchObject({
      inquiryChangeCount: 1,
      inquiryResponseNeedsCheck: true,
      nextCheckLabel: '照会回答の変更点を読み上げ確認',
    });
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
