import { describe, it, expect } from 'vitest';
import { MEDICAL_RULES_2026, MEDICAL_REVISION } from '../revisions/medical/2026';
import { MEDICAL_REVISION as MEDICAL_REVISION_2024 } from '../revisions/medical/2024';

describe('MEDICAL_RULES_2026', () => {
  it('ssot_key が一意であること', () => {
    const keys = MEDICAL_RULES_2026.map((r) => r.ssot_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('全ルールに amount が定義されていること', () => {
    for (const rule of MEDICAL_RULES_2026) {
      expect(typeof rule.amount).toBe('number');
    }
  });

  it('code が一意であること', () => {
    const codes = MEDICAL_RULES_2026.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('33ルールが定義されていること', () => {
    expect(MEDICAL_RULES_2026).toHaveLength(33);
  });

  it('全ルールの source_note が令和8年度を含むこと', () => {
    for (const rule of MEDICAL_RULES_2026) {
      expect(rule.source_note).toContain('令和8年度');
    }
  });

  it('旧 在宅患者重複投薬・相互作用等防止管理料 が存在しないこと', () => {
    const abolishedKeys = [
      'medical.home_duplicate_interaction.change_other',
      'medical.home_duplicate_interaction.change_residual',
      'medical.home_duplicate_interaction.proposal_other',
      'medical.home_duplicate_interaction.proposal_residual',
      'medical.kakaritsuke_visit',
      'medical.kakaritsuke_followup',
    ];
    const ssotKeys = MEDICAL_RULES_2026.map((r) => r.ssot_key);
    for (const key of abolishedKeys) {
      expect(ssotKeys).not.toContain(key);
    }
  });
});

describe('MEDICAL_RULES_2026 — 2026年新設ルール', () => {
  const ruleByKey = (key: string) => MEDICAL_RULES_2026.find((r) => r.ssot_key === key);

  it('薬学的有害事象等防止加算 イ（在宅） 50点', () => {
    const rule = ruleByKey('medical.adverse_event_prevention.home_proposal');
    expect(rule).toBeDefined();
    expect(rule!.code).toBe('MED_ADVERSE_EVENT_HOME_PROPOSAL');
    expect(rule!.amount).toBe(50);
  });

  it('薬学的有害事象等防止加算 ロ（在宅） 50点', () => {
    const rule = ruleByKey('medical.adverse_event_prevention.home_change');
    expect(rule).toBeDefined();
    expect(rule!.code).toBe('MED_ADVERSE_EVENT_HOME_CHANGE');
    expect(rule!.amount).toBe(50);
  });

  it('調剤時残薬調整加算 ロ（在宅） 50点', () => {
    const rule = ruleByKey('medical.residual_adjustment.home');
    expect(rule).toBeDefined();
    expect(rule!.code).toBe('MED_RESIDUAL_ADJUSTMENT_HOME');
    expect(rule!.amount).toBe(50);
  });

  it('複数名薬剤管理指導訪問料 300点', () => {
    const rule = ruleByKey('medical.multi_staff_visit');
    expect(rule).toBeDefined();
    expect(rule!.code).toBe('MED_MULTI_STAFF_VISIT');
    expect(rule!.amount).toBe(300);
  });

  it('訪問薬剤管理医師同時指導料 150点', () => {
    const rule = ruleByKey('medical.physician_simultaneous_guidance');
    expect(rule).toBeDefined();
    expect(rule!.code).toBe('MED_PHYSICIAN_SIMULTANEOUS');
    expect(rule!.amount).toBe(150);
    expect(rule!.conditions.building_tier).toBe('single');
  });
});

describe('MEDICAL_RULES_2026 — 夜間・休日・深夜訪問加算', () => {
  const ruleByKey = (key: string) => MEDICAL_RULES_2026.find((r) => r.ssot_key === key);

  it('夜間訪問加算 400点', () => {
    const rule = ruleByKey('medical.emergency_visit.night_add_on');
    expect(rule).toBeDefined();
    expect(rule!.code).toBe('MED_EMERGENCY_VISIT_NIGHT');
    expect(rule!.amount).toBe(400);
  });

  it('休日訪問加算 600点', () => {
    const rule = ruleByKey('medical.emergency_visit.holiday_add_on');
    expect(rule).toBeDefined();
    expect(rule!.code).toBe('MED_EMERGENCY_VISIT_HOLIDAY');
    expect(rule!.amount).toBe(600);
  });

  it('深夜訪問加算 1000点', () => {
    const rule = ruleByKey('medical.emergency_visit.midnight_add_on');
    expect(rule).toBeDefined();
    expect(rule!.code).toBe('MED_EMERGENCY_VISIT_MIDNIGHT');
    expect(rule!.amount).toBe(1000);
  });
});

describe('MEDICAL_RULES_2026 — 緊急訪問 conditions', () => {
  const emergencyKeys = [
    'medical.emergency_visit.1',
    'medical.emergency_visit.2',
    'medical.emergency_visit.online',
  ];

  it.each(emergencyKeys)('%s に special_monthly_cap: 8 が設定されていること', (key) => {
    const rule = MEDICAL_RULES_2026.find((r) => r.ssot_key === key);
    expect(rule).toBeDefined();
    expect(rule!.conditions.special_monthly_cap).toBe(8);
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
