import { describe, expect, it } from 'vitest';
import {
  detectMedicationChanges,
  formatDoseFrequency,
  prescriptionLineKey,
} from '@/lib/prescription/medication-diff';

// ── Helpers ──

function makeLine(overrides: {
  drug_name: string;
  drug_code?: string | null;
  dose?: string;
  frequency?: string;
}) {
  return {
    drug_name: overrides.drug_name,
    drug_code: overrides.drug_code ?? null,
    dose: overrides.dose ?? '1錠',
    frequency: overrides.frequency ?? '1日1回朝食後',
  };
}

// ── prescriptionLineKey ──

describe('prescriptionLineKey', () => {
  it('returns drug_code when present', () => {
    expect(prescriptionLineKey({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001' })).toBe('YJ001');
  });

  it('falls back to drug_name when drug_code is null', () => {
    expect(prescriptionLineKey({ drug_name: 'アムロジピン錠5mg', drug_code: null })).toBe('アムロジピン錠5mg');
  });

  it('falls back to drug_name when drug_code is undefined', () => {
    expect(prescriptionLineKey({ drug_name: 'アムロジピン錠5mg' })).toBe('アムロジピン錠5mg');
  });
});

// ── formatDoseFrequency ──

describe('formatDoseFrequency', () => {
  it('formats dose and frequency separated by " / "', () => {
    expect(formatDoseFrequency({ dose: '2錠', frequency: '1日2回朝夕食後' })).toBe('2錠 / 1日2回朝夕食後');
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
    const previous = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '1錠' })];
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
    const previous = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', frequency: '1日1回朝食後' })];
    const current = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', frequency: '1日2回朝夕食後' })];
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

  it('reports all changes when multiple drugs are added, removed, and modified simultaneously', () => {
    const previous = [
      makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '1錠' }),
      makeLine({ drug_name: 'メトホルミン塩酸塩錠500mg', drug_code: 'YJ002' }),
    ];
    const current = [
      makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '2錠' }), // dose change
      makeLine({ drug_name: 'ロスバスタチン錠2.5mg', drug_code: 'YJ003' }),           // new drug
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
    const previous = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '1錠', frequency: '1日1回朝食後' })];
    const current = [makeLine({ drug_name: 'アムロジピン錠5mg', drug_code: 'YJ001', dose: '2錠', frequency: '1日2回朝夕食後' })];
    const changes = detectMedicationChanges(current, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0].change_type).toBe('dose_changed');
  });
});
