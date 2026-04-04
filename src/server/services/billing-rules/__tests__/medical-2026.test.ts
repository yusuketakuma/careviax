import { describe, it, expect } from 'vitest';
import { MEDICAL_RULES_2026, MEDICAL_REVISION } from '../revisions/medical/2026';
import { MEDICAL_REVISION as MEDICAL_REVISION_2024 } from '../revisions/medical/2024';

describe('MEDICAL_RULES_2026', () => {
  it('ssot_key が一意であること', () => {
    const keys = MEDICAL_RULES_2026.map(r => r.ssot_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('全ルールに amount が定義されていること', () => {
    for (const rule of MEDICAL_RULES_2026) {
      expect(typeof rule.amount).toBe('number');
    }
  });
});

describe('MEDICAL_REVISION 2024→2026 連続性', () => {
  it('MEDICAL_2024.effectiveTo = 2026-05-31', () => {
    expect(MEDICAL_REVISION_2024.effectiveTo).toEqual(new Date('2026-05-31'));
  });

  it('MEDICAL_2026.effectiveFrom = 2026-06-01', () => {
    expect(MEDICAL_REVISION.effectiveFrom).toEqual(new Date('2026-06-01'));
  });

  it('2024 の effectiveTo と 2026 の effectiveFrom が連続していること', () => {
    const effectiveTo = MEDICAL_REVISION_2024.effectiveTo!;
    const effectiveFrom = MEDICAL_REVISION.effectiveFrom;
    const dayAfterTo = new Date(effectiveTo);
    dayAfterTo.setDate(dayAfterTo.getDate() + 1);
    expect(dayAfterTo).toEqual(effectiveFrom);
  });
});
