import { describe, expect, it } from 'vitest';
import {
  buildPeriodReviewNotices,
  buildPeriodReviewRows,
  buildPeriodSummaryLabel,
  buildProcessingChips,
  classifyLineProcessing,
  type PeriodReviewLineInput,
} from './prescription-period-review.shared';

const LINES: PeriodReviewLineInput[] = [
  {
    drug_name: 'ロキソニン錠60mg',
    frequency: '毎食後',
    days: 10,
    start_date: '2026-05-22',
    notes: '胃薬と確認',
  },
  {
    drug_name: 'アムロジピン錠5mg',
    frequency: '朝食後',
    days: 28,
    start_date: '2026-05-22',
    dispensing_method: 'unit_dose',
    notes: '今回中止→回収',
  },
  {
    drug_name: '酸化Mg錠330mg',
    frequency: '夕食後',
    days: 28,
    start_date: '2026-05-22',
    packaging_instructions: '別包',
  },
  {
    drug_name: '粉薬A',
    frequency: '朝夕',
    days: 14,
    start_date: '2026-05-22',
    dispensing_method: 'crushed',
  },
  { drug_name: '', frequency: '', days: 1 },
];

describe('buildPeriodReviewRows', () => {
  it('builds the 7-column rows, computing the end date from start + days', () => {
    const rows = buildPeriodReviewRows(LINES);

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      drugName: 'ロキソニン錠60mg',
      frequencyLabel: '毎食後',
      daysLabel: '10日',
      startLabel: '5/22',
      endLabel: '5/31',
      processingLabel: '分包なし',
      noteLabel: '胃薬と確認',
    });
    expect(rows[1].endLabel).toBe('6/18');
    expect(rows[1].processingLabel).toBe('一包化');
    expect(rows[2].processingLabel).toBe('別包');
    expect(rows[3].endLabel).toBe('6/4');
    expect(rows[3].processingLabel).toBe('粉砕');
  });

  it('prefers an explicit end date over the computed one', () => {
    const rows = buildPeriodReviewRows([
      {
        drug_name: '頓服薬',
        frequency: '頓用',
        days: 10,
        start_date: '2026-05-22',
        end_date: '2026-05-25',
      },
    ]);
    expect(rows[0].endLabel).toBe('5/25');
  });
});

describe('classifyLineProcessing', () => {
  it('lets packaging instructions override the dispensing method', () => {
    expect(
      classifyLineProcessing({
        drug_name: 'x',
        frequency: 'x',
        days: 1,
        dispensing_method: 'unit_dose',
        packaging_instructions: 'セット対象外(持参)',
      }),
    ).toBe('outside_set');
  });
});

describe('buildPeriodSummaryLabel', () => {
  it('spans the earliest start to the latest end', () => {
    expect(buildPeriodSummaryLabel(LINES)).toBe('2026/05/22〜2026/06/18');
  });

  it('returns null without any dated lines', () => {
    expect(buildPeriodSummaryLabel([{ drug_name: '薬', frequency: 'x', days: 3 }])).toBeNull();
  });
});

describe('buildProcessingChips', () => {
  it('activates chips that are used by the current lines with counts', () => {
    const chips = buildProcessingChips(LINES);
    const byKey = Object.fromEntries(chips.map((chip) => [chip.key, chip]));

    expect(byKey.unit_dose).toMatchObject({ active: true, count: 1 });
    expect(byKey.crushed).toMatchObject({ active: true, count: 1 });
    expect(byKey.no_packaging).toMatchObject({ active: true, count: 1 });
    expect(byKey.separate_pack).toMatchObject({ active: true, count: 1 });
    expect(byKey.outside_set).toMatchObject({ active: false, count: 0 });
  });
});

describe('buildPeriodReviewNotices', () => {
  it('flags crushing as critical and discontinued notes as caution, then appends blockers', () => {
    const notices = buildPeriodReviewNotices({
      lines: LINES,
      submitBlockers: ['患者とケースを選択してください'],
    });

    expect(notices).toEqual([
      { severity: 'critical', text: '粉砕可否は薬剤師確認が必要です' },
      { severity: 'caution', text: '中止薬の回収予定を確認してください' },
      { severity: 'caution', text: '患者とケースを選択してください' },
    ]);
  });

  it('returns an empty list when nothing blocks', () => {
    expect(
      buildPeriodReviewNotices({
        lines: [{ drug_name: '薬', frequency: '朝', days: 7, start_date: '2026-05-22' }],
        submitBlockers: [],
      }),
    ).toEqual([]);
  });
});
