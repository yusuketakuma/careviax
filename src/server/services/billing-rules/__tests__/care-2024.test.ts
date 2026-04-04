import { describe, it, expect } from 'vitest';
import { CARE_RULES_2024 } from '../revisions/care/2024';

describe('CARE_RULES_2024', () => {
  it('居宅療養管理指導費 10人以上は342単位', () => {
    const rule = CARE_RULES_2024.find(r => r.ssot_key === 'care.home_management.pharmacy.multi_10_plus');
    expect(rule).toBeDefined();
    expect(rule!.amount).toBe(342);
  });

  it('介護予防居宅療養管理指導費 10人以上は342単位', () => {
    const rule = CARE_RULES_2024.find(r => r.ssot_key === 'care.prevention.pharmacy.multi_10_plus');
    expect(rule).toBeDefined();
    expect(rule!.amount).toBe(342);
  });

  it('ssot_key が一意である', () => {
    const keys = CARE_RULES_2024.map(r => r.ssot_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('全ルールに amount が定義されている', () => {
    for (const rule of CARE_RULES_2024) {
      expect(rule.amount).toBeGreaterThan(0);
    }
  });
});
