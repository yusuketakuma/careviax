import { describe, expect, it } from 'vitest';
import {
  detectMedicationChanges,
  formatDoseFrequency,
  matchMedicationDiffLines,
  medicationIdentityKey,
  prescriptionLineKey,
} from '@/lib/prescription/medication-diff';

// ── Helpers ──

function makeLine(overrides: {
  drug_name: string;
  drug_master_id?: string | null;
  drug_code?: string | null;
  dose?: string;
  frequency?: string;
}) {
  return {
    drug_name: overrides.drug_name,
    drug_master_id: overrides.drug_master_id ?? null,
    drug_code: overrides.drug_code ?? null,
    dose: overrides.dose ?? '1錠',
    frequency: overrides.frequency ?? '1日1回朝食後',
  };
}

// ── prescriptionLineKey ──

describe('prescriptionLineKey', () => {
  it('uses drug_master_id before drug_code when present', () => {
    expect(
      prescriptionLineKey({
        drug_name: 'アムロジピン錠5mg',
        drug_master_id: 'drug_master_1',
        drug_code: 'YJ001',
        dose: '1錠',
        frequency: '朝食後',
        days: 28,
      }),
    ).toBe('master:drug_master_1|1錠|朝食後|28');
  });

  it('returns drug_code when present', () => {
    expect(
      prescriptionLineKey({
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        dose: '1錠',
        frequency: '朝食後',
        days: 28,
      }),
    ).toBe('code:YJ001|1錠|朝食後|28');
  });

  it('falls back to drug_name when drug_code is null', () => {
    expect(
      prescriptionLineKey({
        drug_name: 'アムロジピン錠5mg',
        drug_code: null,
        dose: '1錠',
        frequency: '朝食後',
      }),
    ).toBe('name:アムロジピン錠5mg|1錠|朝食後|');
  });

  it('falls back to drug_name when drug_code is undefined', () => {
    expect(prescriptionLineKey({ drug_name: 'アムロジピン錠5mg' })).toBe(
      'name:アムロジピン錠5mg|||',
    );
  });

  it('keeps the legacy empty identity empty when no drug code or name exists', () => {
    expect(prescriptionLineKey({ drug_name: '   ' })).toBe('|||');
  });
});

describe('medicationIdentityKey', () => {
  it('prioritizes master identity over canonical code and display name', () => {
    expect(
      medicationIdentityKey({
        drug_name: '同名薬A',
        drug_master_id: 'drug_master_same',
        drug_code: 'YJ_OLD',
      }),
    ).toBe('master:drug_master_same');
  });
});

// ── formatDoseFrequency ──

describe('formatDoseFrequency', () => {
  it('formats dose and frequency separated by " / "', () => {
    expect(formatDoseFrequency({ dose: '2錠', frequency: '1日2回朝夕食後' })).toBe(
      '2錠 / 1日2回朝夕食後',
    );
  });
});

// ── detectMedicationChanges ──

describe('detectMedicationChanges', () => {
  it('returns empty array when current and previous are identical', () => {
    const lines = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001' })];
    expect(detectMedicationChanges(lines, lines)).toHaveLength(0);
  });

  it('detects an added drug when it is present in current but not previous', () => {
    const current = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001' })];
    const changes = detectMedicationChanges(current, []);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      drug_name: 'アムロジピン錠5mg',
      change_type: 'added',
      previous: null,
      current: '1錠 / 1日1回朝食後',
    });
  });

  it('detects a removed drug when it is present in previous but not current', () => {
    const previous = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001' })];
    const changes = detectMedicationChanges([], previous);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      drug_name: 'アムロジピン錠5mg',
      change_type: 'removed',
      previous: '1錠 / 1日1回朝食後',
      current: null,
    });
  });

  it('detects dose_changed when dose differs but frequency is the same', () => {
    const previous = [
      makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '1錠' }),
    ];
    const current = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '2錠' })];
    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      drug_name: 'アムロジピン錠5mg',
      change_type: 'dose_changed',
      previous: '1錠 / 1日1回朝食後',
      current: '2錠 / 1日1回朝食後',
    });
  });

  it('detects frequency_changed when frequency differs but dose is the same', () => {
    const previous = [
      makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', frequency: '1日1回朝食後' }),
    ];
    const current = [
      makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', frequency: '1日2回朝夕食後' }),
    ];
    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      drug_name: 'アムロジピン錠5mg',
      change_type: 'frequency_changed',
      previous: '1錠 / 1日1回朝食後',
      current: '1錠 / 1日2回朝夕食後',
    });
  });

  it('uses drug_code as the identity key so same drug_name with different codes are treated as distinct drugs', () => {
    const previous = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001' })];
    const current = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ002' })];
    const changes = detectMedicationChanges(current, previous);

    // YJ002 is new (added), YJ001 is gone (removed)
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.change_type).sort()).toEqual(['added', 'removed']);
  });

  it('uses drug_master_id as the strongest identity even when canonical codes differ', () => {
    const previous = [
      makeLine({
        drug_name: '旧表示名',
        drug_master_id: 'drug_master_1',
        drug_code: 'YJ_OLD',
      }),
    ];
    const current = [
      makeLine({
        drug_name: '新表示名',
        drug_master_id: 'drug_master_1',
        drug_code: 'YJ_NEW',
        dose: '2錠',
      }),
    ];
    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      drug_name: '新表示名',
      drug_code: 'YJ_NEW',
      change_type: 'dose_changed',
    });
  });

  it('treats different drug_master_id values as distinct even when drug_code is the same', () => {
    const previous = [
      makeLine({
        drug_name: '同一コード薬A',
        drug_master_id: 'drug_master_a',
        drug_code: 'YJ001',
      }),
    ];
    const current = [
      makeLine({
        drug_name: '同一コード薬B',
        drug_master_id: 'drug_master_b',
        drug_code: 'YJ001',
      }),
    ];
    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.change_type).sort()).toEqual(['added', 'removed']);
  });

  it('does not treat unresolved blank identity rows as unchanged', () => {
    const previous = [makeLine({ drug_name: '   ', drug_code: null })];
    const current = [makeLine({ drug_name: '   ', drug_code: null })];

    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.change_type).sort()).toEqual(['added', 'removed']);
  });

  it('does not match an unresolved drug_name that happens to equal a resolved drug_code', () => {
    const previous = [makeLine({ drug_name: '2149001', drug_code: null })];
    const current = [makeLine({ drug_name: '別薬', drug_code: '2149001' })];
    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          drug_name: '別薬',
          drug_code: '2149001',
          change_type: 'added',
        }),
        expect.objectContaining({
          drug_name: '2149001',
          drug_code: null,
          change_type: 'removed',
        }),
      ]),
    );
  });

  it('does not collapse same drug code rows with different frequency', () => {
    const previous = [
      makeLine({
        drug_name: 'メトホルミン錠500mg',
        drug_code: 'YJ002',
        frequency: '朝食後',
      }),
      makeLine({
        drug_name: 'メトホルミン錠500mg',
        drug_code: 'YJ002',
        frequency: '夕食後',
      }),
    ];
    const current = [
      makeLine({
        drug_name: 'メトホルミン錠500mg',
        drug_code: 'YJ002',
        frequency: '朝食後',
      }),
    ];

    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      drug_name: 'メトホルミン錠500mg',
      change_type: 'removed',
      previous: '1錠 / 夕食後',
    });
  });

  it('reports all changes when multiple drugs are added, removed, and modified simultaneously', () => {
    const previous = [
      makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '1錠' }),
      makeLine({ drug_name: 'メトホルミン塩酸塩錠500mg', drug_code: 'YJ002' }),
    ];
    const current = [
      makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '2錠' }), // dose change
      makeLine({ drug_name: 'ロスバスタチン錠2.5mg', drug_code: 'YJ003' }), // new drug
      // YJ002 removed
    ];
    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(3);
    const byType = Object.fromEntries(changes.map((c) => [c.change_type, c]));
    expect(byType['dose_changed'].drug_name).toBe('アムロジピン錠5mg');
    expect(byType['added'].drug_name).toBe('ロスバスタチン錠2.5mg');
    expect(byType['removed'].drug_name).toBe('メトホルミン塩酸塩錠500mg');
  });

  it('dose_changed takes priority over frequency_changed when both dose and frequency differ', () => {
    // The implementation checks dose first; if dose differs it records dose_changed
    // without also checking frequency — this test locks that behavior in.
    const previous = [
      makeLine({
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        dose: '1錠',
        frequency: '1日1回朝食後',
      }),
    ];
    const current = [
      makeLine({
        drug_name: 'アムロジピン錠5mg',
        drug_code: 'YJ001',
        dose: '2錠',
        frequency: '1日2回朝夕食後',
      }),
    ];
    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0].change_type).toBe('dose_changed');
  });
});

describe('matchMedicationDiffLines', () => {
  it('keeps unresolved blank identity rows unmatched even when dose and frequency are equal', () => {
    const previous = [makeLine({ drug_name: '   ', drug_code: null })];
    const current = [makeLine({ drug_name: '   ', drug_code: null })];

    const matches = matchMedicationDiffLines(current, previous);

    expect(matches).toHaveLength(2);
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ current_index: 0, previous_index: null }),
        expect.objectContaining({ current_index: null, previous_index: 0 }),
      ]),
    );
  });

  it('matches duplicate drug rows by exact line first without collapsing by drug name', () => {
    const previous = [
      makeLine({
        drug_name: 'メトホルミン錠500mg',
        drug_code: 'YJ002',
        dose: '1錠',
        frequency: '朝食後',
      }),
      makeLine({
        drug_name: 'メトホルミン錠500mg',
        drug_code: 'YJ002',
        dose: '1錠',
        frequency: '夕食後',
      }),
    ];
    const current = [
      makeLine({
        drug_name: 'メトホルミン錠500mg',
        drug_code: 'YJ002',
        dose: '1錠',
        frequency: '朝食後',
      }),
      makeLine({
        drug_name: 'メトホルミン錠500mg',
        drug_code: 'YJ002',
        dose: '2錠',
        frequency: '夕食後',
      }),
    ];

    const matches = matchMedicationDiffLines(current, previous);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      current_index: 0,
      previous_index: 0,
    });
    expect(matches[1]).toMatchObject({
      current_index: 1,
      previous_index: 1,
    });
    expect(matches[1].previous?.frequency).toBe('夕食後');
  });
});
