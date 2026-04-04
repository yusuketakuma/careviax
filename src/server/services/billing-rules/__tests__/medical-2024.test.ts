import { describe, it, expect } from 'vitest';
import { MEDICAL_RULES_2024 } from '../revisions/medical/2024';

describe('MEDICAL_RULES_2024', () => {
  it('小児特定加算（オンライン）は350点', () => {
    const rule = MEDICAL_RULES_2024.find(r => r.ssot_key === 'medical.addition.pediatric_special_online');
    expect(rule).toBeDefined();
    expect(rule!.amount).toBe(350);
  });

  it('小児特定加算の対面/オンライン排他制御', () => {
    const online = MEDICAL_RULES_2024.find(r => r.code === 'MED_ADD_PEDIATRIC_SPECIAL_ONLINE');
    const inPerson = MEDICAL_RULES_2024.find(r => r.code === 'MED_ADD_PEDIATRIC_SPECIAL');
    expect(online?.exclusion_rules?.same_month_exclusive).toContain('MED_ADD_PEDIATRIC_SPECIAL');
    expect(inPerson?.exclusion_rules?.same_month_exclusive).toContain('MED_ADD_PEDIATRIC_SPECIAL_ONLINE');
  });

  it('ssot_key が一意である', () => {
    const keys = MEDICAL_RULES_2024.map(r => r.ssot_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('在宅患者訪問薬剤管理指導料 単一建物1人は650点', () => {
    const rule = MEDICAL_RULES_2024.find(r => r.ssot_key === 'medical.home_visit.single');
    expect(rule).toBeDefined();
    expect(rule!.amount).toBe(650);
  });

  it('在宅移行初期管理料は230点', () => {
    const rule = MEDICAL_RULES_2024.find(r => r.ssot_key === 'medical.home_transition_initial');
    expect(rule).toBeDefined();
    expect(rule!.amount).toBe(230);
  });
});
