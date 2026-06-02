import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureHomeCareBillingSsotMock } = vi.hoisted(() => ({
  ensureHomeCareBillingSsotMock: vi.fn(),
}));

vi.mock('./seeder', () => ({
  ensureHomeCareBillingSsot: ensureHomeCareBillingSsotMock,
  HOME_CARE_BILLING_RULESET_VERSION: 'home-care-ssot-registry-v2',
}));

import { buildBillingCandidateSpecs } from './rule-engine';
import type { HomeCareBillingRuleEngineTx } from './rule-engine';
import type { BillingEvidenceContext, BillingRuleConditions } from './types';

// ── Helpers ──

type MockBillingRule = {
  id: string;
  ssot_key: string;
  rule_type: 'base' | 'addition' | 'regional_addition' | 'reduction';
  code: string;
  name: string;
  amount: number;
  billing_scope: string;
  service_type: 'medical_home_visit' | 'care_home_management' | 'generic';
  payer_basis: 'medical' | 'care';
  provider_scope: 'pharmacy' | 'hospital_clinic' | null;
  selection_mode: 'auto' | 'manual';
  calculation_unit: 'point' | 'unit' | 'percent';
  source_url: string;
  source_note: string;
  is_active: boolean;
  effective_from: Date | null;
  effective_to: Date | null;
  created_at: Date;
  conditions: BillingRuleConditions;
  exclusion_rules?: Record<string, unknown>;
};

function makeBaseRule(overrides: Partial<MockBillingRule> = {}): MockBillingRule {
  return {
    id: 'rule_base_1',
    ssot_key: 'medical.home_visit.single',
    rule_type: 'base',
    code: 'MED_HOME_VISIT_SINGLE',
    name: '在宅患者訪問薬剤管理指導料 単一建物1人',
    amount: 650,
    billing_scope: 'home_care_ssot',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'point',
    source_url: 'https://example.com',
    source_note: 'test',
    is_active: true,
    effective_from: null,
    effective_to: null,
    created_at: new Date(),
    conditions: { building_tier: 'single', monthly_cap: 4, weekly_pharmacist_cap: 40 },
    ...overrides,
  };
}

function makeAdditionRule(overrides: Partial<MockBillingRule> = {}): MockBillingRule {
  return {
    id: 'rule_add_1',
    ssot_key: 'medical.addition.narcotic',
    rule_type: 'addition',
    code: 'MED_ADD_NARCOTIC',
    name: '麻薬管理指導加算',
    amount: 100,
    billing_scope: 'home_care_ssot',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    source_url: 'https://example.com',
    source_note: 'test',
    is_active: true,
    effective_from: null,
    effective_to: null,
    created_at: new Date(),
    conditions: { requires_narcotic_management: true },
    ...overrides,
  };
}

function makeContext(overrides: Partial<BillingEvidenceContext> = {}): BillingEvidenceContext {
  return {
    orgId: 'org_1',
    payerBasis: 'medical',
    serviceType: 'medical_home_visit',
    providerScope: 'pharmacy',
    buildingPatientCount: 1,
    monthlyVisitCount: 1,
    weeklyVisitCount: 1,
    claimable: true,
    ...overrides,
  };
}

/** Build a mock tx that feeds rules into the real getHomeCareBillingSsotSummary */
function makeTx(rules: MockBillingRule[]): HomeCareBillingRuleEngineTx {
  return {
    sourceOfTruthMatrix: {
      findFirst: vi.fn().mockResolvedValue({ id: 'matrix_1', entity_type: 'billing' }),
      upsert: vi.fn().mockResolvedValue({ id: 'matrix_1' }),
    },
    billingRule: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue(rules),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('rule-engine: buildBillingCandidateSpecs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureHomeCareBillingSsotMock.mockResolvedValue(undefined);
  });

  // ── 1. single building ──
  it('selects single tier base rule for 1 patient', async () => {
    const singleRule = makeBaseRule({
      conditions: { building_tier: 'single', monthly_cap: 4, weekly_pharmacist_cap: 40 },
    });
    const tx = makeTx([singleRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ buildingPatientCount: 1 }));

    expect(specs).toHaveLength(1);
    expect(specs[0].ssotKey).toBe('medical.home_visit.single');
    expect(specs[0].status).toBe('confirmed');
    expect(specs[0].points).toBe(650);
    expect(specs[0].calculationBreakdown).toEqual(
      expect.objectContaining({ building_tier: 'single' }),
    );
  });

  // ── 2. multi_2_9 building ──
  it('selects multi_2_9 tier for 5 patients', async () => {
    const multiRule = makeBaseRule({
      ssot_key: 'medical.home_visit.multi_2_9',
      code: 'MED_HOME_VISIT_MULTI_2_9',
      name: '在宅患者訪問薬剤管理指導料 同一建物2-9人',
      amount: 320,
      conditions: { building_tier: 'multi_2_9', monthly_cap: 4, weekly_pharmacist_cap: 40 },
    });
    const tx = makeTx([multiRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ buildingPatientCount: 5 }));

    expect(specs).toHaveLength(1);
    expect(specs[0].ssotKey).toBe('medical.home_visit.multi_2_9');
    expect(specs[0].status).toBe('confirmed');
    expect(specs[0].points).toBe(320);
    expect(specs[0].calculationBreakdown).toEqual(
      expect.objectContaining({ building_tier: 'multi_2_9' }),
    );
  });

  // ── 3. multi_10_plus building ──
  it('selects multi_10_plus tier for 15 patients', async () => {
    const multiRule = makeBaseRule({
      ssot_key: 'medical.home_visit.multi_10_plus',
      code: 'MED_HOME_VISIT_MULTI_10_PLUS',
      name: '在宅患者訪問薬剤管理指導料 同一建物10人以上',
      amount: 290,
      conditions: { building_tier: 'multi_10_plus', monthly_cap: 4, weekly_pharmacist_cap: 40 },
    });
    const tx = makeTx([multiRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ buildingPatientCount: 15 }));

    expect(specs).toHaveLength(1);
    expect(specs[0].ssotKey).toBe('medical.home_visit.multi_10_plus');
    expect(specs[0].status).toBe('confirmed');
    expect(specs[0].points).toBe(290);
    expect(specs[0].calculationBreakdown).toEqual(
      expect.objectContaining({ building_tier: 'multi_10_plus' }),
    );
  });

  // ── 4. emergency visit ──
  it('selects emergency rule when visitType is emergency', async () => {
    const emergencyRule = makeBaseRule({
      ssot_key: 'medical.emergency_visit.2',
      code: 'MED_EMERGENCY_VISIT_2',
      name: '在宅患者緊急訪問薬剤管理指導料2',
      amount: 200,
      conditions: { visit_type: 'emergency', emergency_category: 'other_exacerbation' },
    });
    const tx = makeTx([emergencyRule]);

    const specs = await buildBillingCandidateSpecs(
      tx,
      makeContext({
        visitType: 'emergency',
        emergencyCategory: 'other_exacerbation',
      }),
    );

    expect(specs).toHaveLength(1);
    expect(specs[0].ssotKey).toBe('medical.emergency_visit.2');
    expect(specs[0].status).toBe('confirmed');
    expect(specs[0].points).toBe(200);
  });

  // ── 5. emergency with no category defaults to other_exacerbation ──
  it('defaults to other_exacerbation when emergency has no category', async () => {
    const emergencyRule = makeBaseRule({
      ssot_key: 'medical.emergency_visit.2',
      code: 'MED_EMERGENCY_VISIT_2',
      name: '在宅患者緊急訪問薬剤管理指導料2',
      amount: 200,
      conditions: { visit_type: 'emergency', emergency_category: 'other_exacerbation' },
    });
    const tx = makeTx([emergencyRule]);

    const specs = await buildBillingCandidateSpecs(
      tx,
      makeContext({
        visitType: 'emergency',
        emergencyCategory: null, // no category
      }),
    );

    expect(specs).toHaveLength(1);
    expect(specs[0].ssotKey).toBe('medical.emergency_visit.2');
    expect(specs[0].status).toBe('confirmed');
  });

  // ── 6. online visit ──
  it('selects online rule when onlineEligible is true', async () => {
    const onlineRule = makeBaseRule({
      ssot_key: 'medical.home_visit.online',
      code: 'MED_HOME_VISIT_ONLINE',
      name: '在宅患者オンライン薬剤管理指導料',
      amount: 59,
      conditions: { requires_online_visit: true },
    });
    const singleRule = makeBaseRule(); // should be skipped
    const tx = makeTx([singleRule, onlineRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ onlineEligible: true }));

    const base = specs.find((s) => s.ssotKey === 'medical.home_visit.online');
    expect(base).toBeDefined();
    expect(base!.status).toBe('confirmed');
    expect(base!.points).toBe(59);
  });

  // ── 7. monthly cap exceeded ──
  it('marks base rule as excluded when monthly cap is exceeded', async () => {
    const singleRule = makeBaseRule({
      conditions: { building_tier: 'single', monthly_cap: 4, weekly_pharmacist_cap: 40 },
    });
    const tx = makeTx([singleRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ monthlyVisitCount: 5 }));

    expect(specs).toHaveLength(1);
    expect(specs[0].status).toBe('excluded');
    expect(specs[0].exclusionReason).toContain('月内算定上限');
  });

  // ── 8. weekly cap exceeded ──
  it('marks base rule as excluded when weekly cap is exceeded', async () => {
    const singleRule = makeBaseRule({
      conditions: { building_tier: 'single', monthly_cap: 4, weekly_pharmacist_cap: 40 },
    });
    const tx = makeTx([singleRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ weeklyVisitCount: 41 }));

    expect(specs).toHaveLength(1);
    expect(specs[0].status).toBe('excluded');
    expect(specs[0].exclusionReason).toContain('週内算定上限');
  });

  // ── 9. narcotic management addition ──
  it('includes narcotic management addition when narcoticRequired=true', async () => {
    const singleRule = makeBaseRule();
    const narcoticRule = makeAdditionRule({
      conditions: { requires_narcotic_management: true },
    });
    const tx = makeTx([singleRule, narcoticRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ narcoticRequired: true }));

    const addition = specs.find((s) => s.ssotKey === 'medical.addition.narcotic');
    expect(addition).toBeDefined();
    expect(addition!.status).toBe('candidate');
    expect(addition!.points).toBe(100);
  });

  // ── 10. infant addition ──
  it('includes infant addition when infantEligible=true', async () => {
    const singleRule = makeBaseRule();
    const infantRule = makeAdditionRule({
      ssot_key: 'medical.addition.infant',
      code: 'MED_ADD_INFANT',
      name: '乳幼児加算',
      amount: 100,
      conditions: { requires_infant_eligibility: true },
    });
    const tx = makeTx([singleRule, infantRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ infantEligible: true }));

    const addition = specs.find((s) => s.ssotKey === 'medical.addition.infant');
    expect(addition).toBeDefined();
    expect(addition!.status).toBe('candidate');
  });

  // ── 11. after-hours visit ──
  it('includes after-hours addition when afterHoursVisit matches', async () => {
    const singleRule = makeBaseRule();
    const nightRule = makeAdditionRule({
      ssot_key: 'medical.addition.night',
      code: 'MED_ADD_NIGHT',
      name: '夜間加算',
      amount: 480,
      conditions: { after_hours_visit: 'night' },
    });
    const holidayRule = makeAdditionRule({
      ssot_key: 'medical.addition.holiday',
      code: 'MED_ADD_HOLIDAY',
      name: '休日加算',
      amount: 1400,
      conditions: { after_hours_visit: 'holiday' },
    });
    const tx = makeTx([singleRule, nightRule, holidayRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext({ afterHoursVisit: 'night' }));

    const nightAddition = specs.find((s) => s.ssotKey === 'medical.addition.night');
    const holidayAddition = specs.find((s) => s.ssotKey === 'medical.addition.holiday');
    expect(nightAddition).toBeDefined();
    expect(nightAddition!.status).toBe('candidate');
    expect(holidayAddition).toBeDefined();
    // holiday rule should be excluded since afterHoursVisit is 'night', not 'holiday'
    expect(holidayAddition!.status).toBe('excluded');
  });

  // ── 12. claimable=false excludes all specs ──
  it('excludes all specs when claimable=false', async () => {
    const singleRule = makeBaseRule();
    const narcoticRule = makeAdditionRule();
    const tx = makeTx([singleRule, narcoticRule]);

    const specs = await buildBillingCandidateSpecs(
      tx,
      makeContext({ claimable: false, narcoticRequired: true }),
    );

    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec.status).toBe('excluded');
    }
  });

  // ── 13. percent-based addition ──
  it('calculates points for percent-based additions using Math.round', async () => {
    const singleRule = makeBaseRule({ amount: 650 });
    const percentRule = makeAdditionRule({
      ssot_key: 'medical.addition.percent_test',
      code: 'MED_ADD_PERCENT',
      name: 'パーセント加算テスト',
      amount: 15, // 15%
      calculation_unit: 'percent',
      conditions: {},
    });
    const tx = makeTx([singleRule, percentRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext());

    const percentAddition = specs.find((s) => s.ssotKey === 'medical.addition.percent_test');
    expect(percentAddition).toBeDefined();
    // Math.round(650 * 15 / 100) = Math.round(97.5) = 98
    expect(percentAddition!.points).toBe(98);
    expect(percentAddition!.calculationBreakdown).toEqual(
      expect.objectContaining({
        calculation_unit: 'percent',
        rate_percent: 15,
        base_points: 650,
        derived_points: 98,
      }),
    );
  });

  it('normalizes malformed manual rule conditions before exposing calculation breakdown', async () => {
    const singleRule = makeBaseRule();
    const malformedRule = makeAdditionRule({
      ssot_key: 'medical.addition.malformed_conditions',
      code: 'MED_ADD_MALFORMED',
      name: '不正条件加算',
      conditions: ['unexpected'] as unknown as BillingRuleConditions,
    });
    const tx = makeTx([singleRule, malformedRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext());

    const addition = specs.find((s) => s.ssotKey === 'medical.addition.malformed_conditions');
    expect(addition).toBeDefined();
    expect(addition!.status).toBe('candidate');
    expect(addition!.calculationBreakdown).toEqual(
      expect.objectContaining({
        conditions: {},
      }),
    );
  });

  it('does not include inquiry-derived home adverse event rules in visit candidate specs', async () => {
    const singleRule = makeBaseRule();
    const inquiryDerivedRule = makeAdditionRule({
      ssot_key: 'medical.adverse_event_prevention.home_proposal',
      code: 'MED_ADVERSE_EVENT_HOME_PROPOSAL',
      name: '薬学的有害事象等防止加算 イ（在宅・処方提案反映）',
      conditions: { adverse_event_prevention_type: 'proposal_reflected' },
    });
    const tx = makeTx([singleRule, inquiryDerivedRule]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext());

    expect(specs).toHaveLength(1);
    expect(specs.find((s) => s.code === 'MED_ADVERSE_EVENT_HOME_PROPOSAL')).toBeUndefined();
  });

  it('keeps multi-staff visit excluded until the visit is explicitly marked eligible', async () => {
    const singleRule = makeBaseRule();
    const multiStaffRule = makeAdditionRule({
      ssot_key: 'medical.multi_staff_visit',
      code: 'MED_MULTI_STAFF_VISIT',
      name: '複数名薬剤管理指導訪問料',
      conditions: { building_tier: 'single', requires_multi_staff_visit: true },
    });
    const tx = makeTx([singleRule, multiStaffRule]);

    const withoutEligibility = await buildBillingCandidateSpecs(tx, makeContext());
    expect(withoutEligibility.find((s) => s.code === 'MED_MULTI_STAFF_VISIT')?.status).toBe(
      'excluded',
    );

    const withEligibility = await buildBillingCandidateSpecs(
      tx,
      makeContext({ multiStaffVisitEligible: true }),
    );
    expect(withEligibility.find((s) => s.code === 'MED_MULTI_STAFF_VISIT')?.status).toBe(
      'candidate',
    );
  });

  it('requires both single-building and explicit eligibility for physician simultaneous guidance', async () => {
    const singleRule = makeBaseRule();
    const physicianSimultaneousRule = makeAdditionRule({
      ssot_key: 'medical.physician_simultaneous_guidance',
      code: 'MED_PHYSICIAN_SIMULTANEOUS',
      name: '訪問薬剤管理医師同時指導料',
      conditions: { building_tier: 'single', requires_physician_simultaneous: true },
    });
    const tx = makeTx([singleRule, physicianSimultaneousRule]);

    const multiBuilding = await buildBillingCandidateSpecs(
      tx,
      makeContext({ buildingPatientCount: 3, physicianSimultaneousEligible: true }),
    );
    expect(multiBuilding.find((s) => s.code === 'MED_PHYSICIAN_SIMULTANEOUS')?.status).toBe(
      'excluded',
    );

    const singleBuilding = await buildBillingCandidateSpecs(
      tx,
      makeContext({ physicianSimultaneousEligible: true }),
    );
    expect(singleBuilding.find((s) => s.code === 'MED_PHYSICIAN_SIMULTANEOUS')?.status).toBe(
      'candidate',
    );
  });

  it('requires pharmacy-site facility standard before suggesting dispensing base-up fee', async () => {
    const singleRule = makeBaseRule();
    const baseUpRule = makeAdditionRule({
      ssot_key: 'medical.dispensing_base_up_evaluation',
      code: 'MED_DISPENSING_BASE_UP_EVALUATION',
      name: '調剤ベースアップ評価料',
      amount: 4,
      service_type: 'generic',
      conditions: {
        per_prescription_acceptance: true,
        pharmacy_acceptance_fee: true,
        facility_standard_required: 'dispensing_base_up_evaluation',
      },
    });
    const tx = makeTx([singleRule, baseUpRule]);

    const withoutStandard = await buildBillingCandidateSpecs(tx, makeContext());
    const excluded = withoutStandard.find((s) => s.code === 'MED_DISPENSING_BASE_UP_EVALUATION');
    expect(excluded).toBeDefined();
    expect(excluded!.status).toBe('excluded');
    expect(excluded!.exclusionReason).toContain('dispensing_base_up_evaluation');

    const withStandard = await buildBillingCandidateSpecs(
      tx,
      makeContext({ facilityStandards: { dispensing_base_up_evaluation: true } }),
    );
    expect(withStandard.find((s) => s.code === 'MED_DISPENSING_BASE_UP_EVALUATION')?.status).toBe(
      'candidate',
    );
  });

  // ── 14. exclusion_rules same_month_exclusive ──
  it('includes addition candidates regardless of exclusion_rules (enforcement is downstream)', async () => {
    const singleRule = makeBaseRule();
    const additionA = makeAdditionRule({
      ssot_key: 'medical.addition.a',
      code: 'MED_ADD_A',
      name: '加算A',
      amount: 50,
      conditions: {},
      exclusion_rules: { same_month_exclusive: ['MED_ADD_B'] },
    });
    const additionB = makeAdditionRule({
      ssot_key: 'medical.addition.b',
      code: 'MED_ADD_B',
      name: '加算B',
      amount: 30,
      conditions: {},
      exclusion_rules: { same_month_exclusive: ['MED_ADD_A'] },
    });
    const tx = makeTx([singleRule, additionA, additionB]);

    const specs = await buildBillingCandidateSpecs(tx, makeContext());

    // Both additions should be included as candidates — exclusion enforcement happens later
    const specA = specs.find((s) => s.ssotKey === 'medical.addition.a');
    const specB = specs.find((s) => s.ssotKey === 'medical.addition.b');
    expect(specA).toBeDefined();
    expect(specB).toBeDefined();
    expect(specA!.status).toBe('candidate');
    expect(specB!.status).toBe('candidate');
  });
});
