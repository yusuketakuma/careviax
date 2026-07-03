import { describe, expect, it } from 'vitest';
import { checkDateContinuity } from '../date-continuity';

// ── Helpers ──

function makeLine(overrides: {
  id: string;
  drug_name: string;
  drug_master_id?: string | null;
  drug_code?: string | null;
  start_date?: Date | null;
  end_date?: Date | null;
}) {
  return {
    id: overrides.id,
    drug_name: overrides.drug_name,
    drug_master_id: overrides.drug_master_id ?? null,
    drug_code: overrides.drug_code ?? null,
    start_date: overrides.start_date ?? null,
    end_date: overrides.end_date ?? null,
  };
}

// ── Tests ──

describe('checkDateContinuity', () => {
  it('formats warning date keys from UTC date sentinels independently of runtime timezone', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const prev = [
        makeLine({
          id: 'p1',
          drug_name: 'アムロジピン錠5mg',
          drug_code: 'YJ001',
          end_date: new Date('2026-03-28T00:00:00.000Z'),
        }),
      ];
      const current = [
        makeLine({
          id: 'c1',
          drug_name: 'アムロジピン錠5mg',
          drug_code: 'YJ001',
          start_date: new Date('2026-04-01T00:00:00.000Z'),
        }),
      ];

      expect(checkDateContinuity(current, prev)[0]).toMatchObject({
        prevEndDate: '2026-03-28',
        currentStartDate: '2026-04-01',
      });
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('returns no warnings when dates are exactly continuous (gap = 0)', () => {
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        end_date: new Date('2026-03-28'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        start_date: new Date('2026-03-28'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(0);
  });

  it('returns no warnings when gap is exactly 1 day (normal next-day start)', () => {
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        end_date: new Date('2026-03-28'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        start_date: new Date('2026-03-29'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(0);
  });

  it('returns gap warning when gap > 1 day', () => {
    // end_date = 2026-03-28, start_date = 2026-04-01 → gap = 4 days
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        end_date: new Date('2026-03-28'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        start_date: new Date('2026-04-01'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      lineId: 'c1',
      drugName: 'アムロジピン錠5mg',
      drugCode: 'YJ001',
      type: 'gap',
      prevEndDate: '2026-03-28',
      currentStartDate: '2026-04-01',
      gapDays: 4,
    });
  });

  it('returns overlap warning when start_date < end_date (gap is negative)', () => {
    // end_date = 2026-04-05, start_date = 2026-04-01 → overlap = -4 days
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        end_date: new Date('2026-04-05'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        start_date: new Date('2026-04-01'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      lineId: 'c1',
      drugName: 'アムロジピン錠5mg',
      drugCode: 'YJ001',
      type: 'overlap',
      prevEndDate: '2026-04-05',
      currentStartDate: '2026-04-01',
      gapDays: -4,
    });
  });

  it('returns no warning when current start_date is null (skip)', () => {
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        end_date: new Date('2026-03-28'),
      }),
    ];
    const current = [
      makeLine({ id: 'c1', drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', start_date: null }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(0);
  });

  it('returns no warning when previous end_date is null (skip)', () => {
    const prev = [
      makeLine({ id: 'p1', drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', end_date: null }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        start_date: new Date('2026-04-01'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(0);
  });

  it('handles multiple lines with mixed gaps and overlaps', () => {
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: '薬A',
        drug_code: 'CODE_A',
        end_date: new Date('2026-03-28'),
      }),
      makeLine({
        id: 'p2',
        drug_name: '薬B',
        drug_code: 'CODE_B',
        end_date: new Date('2026-04-05'),
      }),
      makeLine({
        id: 'p3',
        drug_name: '薬C',
        drug_code: 'CODE_C',
        end_date: new Date('2026-03-28'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: '薬A',
        drug_code: 'CODE_A',
        start_date: new Date('2026-04-01'),
      }), // gap 4 days
      makeLine({
        id: 'c2',
        drug_name: '薬B',
        drug_code: 'CODE_B',
        start_date: new Date('2026-04-01'),
      }), // overlap -4 days
      makeLine({
        id: 'c3',
        drug_name: '薬C',
        drug_code: 'CODE_C',
        start_date: new Date('2026-03-29'),
      }), // continuous (gap=1), no warning
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(2);

    const gapWarning = warnings.find((w) => w.lineId === 'c1');
    expect(gapWarning).toMatchObject({ type: 'gap', gapDays: 4 });

    const overlapWarning = warnings.find((w) => w.lineId === 'c2');
    expect(overlapWarning).toMatchObject({ type: 'overlap', gapDays: -4 });
  });

  it('matches lines by drug_code when available', () => {
    // Same drug_name but different drug_code — must match by drug_code
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: '薬X',
        drug_code: 'CORRECT_CODE',
        end_date: new Date('2026-03-28'),
      }),
      makeLine({
        id: 'p2',
        drug_name: '薬X',
        drug_code: 'OTHER_CODE',
        end_date: new Date('2026-03-20'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: '薬X',
        drug_code: 'CORRECT_CODE',
        start_date: new Date('2026-04-01'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: 'gap', gapDays: 4 }); // matched CORRECT_CODE end=3-28, not OTHER_CODE end=3-20
  });

  it('matches by drug_master_id before drug_code when checking continuity', () => {
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: '旧表示名',
        drug_master_id: 'drug_master_1',
        drug_code: 'YJ_OLD',
        end_date: new Date('2026-03-28'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: '新表示名',
        drug_master_id: 'drug_master_1',
        drug_code: 'YJ_NEW',
        start_date: new Date('2026-04-01'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      lineId: 'c1',
      drugName: '新表示名',
      drugCode: 'YJ_NEW',
      type: 'gap',
      gapDays: 4,
    });
  });

  it('falls back to drug_name matching when drug_code is null', () => {
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: null,
        end_date: new Date('2026-03-28'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: null,
        start_date: new Date('2026-04-01'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: 'gap', gapDays: 4, drugCode: null });
  });

  it('does not match an unresolved drug name to a resolved drug code with the same text', () => {
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: '2149001',
        drug_code: null,
        end_date: new Date('2026-03-28'),
      }),
    ];
    const current = [
      makeLine({
        id: 'c1',
        drug_name: '別名薬',
        drug_code: '2149001',
        start_date: new Date('2026-04-01'),
      }),
    ];

    const warnings = checkDateContinuity(current, prev);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty warnings when there are no previous lines', () => {
    const current = [
      makeLine({
        id: 'c1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        start_date: new Date('2026-04-01'),
      }),
    ];

    const warnings = checkDateContinuity(current, []);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty warnings when there are no current lines', () => {
    const prev = [
      makeLine({
        id: 'p1',
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        end_date: new Date('2026-03-28'),
      }),
    ];

    const warnings = checkDateContinuity([], prev);
    expect(warnings).toHaveLength(0);
  });
});
