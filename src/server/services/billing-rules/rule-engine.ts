import type { BillingEvidenceContext, BillingCandidateSpec } from './types';
import { ensureHomeCareBillingSsot, type HomeCareBillingSsotTx } from './seeder';
import { HOME_CARE_BILLING_RULESET_VERSION } from './seeder';
import { readJsonObject } from '@/lib/db/json';

export type BillingRuleRow = {
  id: string;
  ssot_key: string | null;
  rule_type: string | null;
  code: string | null;
  name: string;
  amount: number;
  billing_scope: string | null;
  service_type: string | null;
  payer_basis: string | null;
  provider_scope: string | null;
  selection_mode: string | null;
  calculation_unit: string | null;
  source_url: string | null;
  source_note: string | null;
  conditions: unknown;
  created_at?: Date;
};

export type HomeCareBillingRuleEngineTx = HomeCareBillingSsotTx & {
  billingRule: HomeCareBillingSsotTx['billingRule'] & {
    findMany(args: unknown): Promise<BillingRuleRow[]>;
  };
  sourceOfTruthMatrix: HomeCareBillingSsotTx['sourceOfTruthMatrix'] & {
    findFirst(args: unknown): Promise<unknown>;
  };
};

type Tx = HomeCareBillingRuleEngineTx;

function buildingTier(buildingPatientCount: number) {
  if (buildingPatientCount >= 10) return 'multi_10_plus';
  if (buildingPatientCount >= 2) return 'multi_2_9';
  return 'single';
}

function conditionValue(
  rule: Awaited<ReturnType<typeof getHomeCareBillingSsotSummary>>['rules'][number],
  key: string,
) {
  return readRuleConditions(rule)[key];
}

function readRuleConditions(rule: { conditions: unknown }) {
  return readJsonObject(rule.conditions) ?? {};
}

function hasRegionAddOn(
  regionAddOns: BillingEvidenceContext['regionAddOnEligible'],
  regionKey: string,
) {
  return (regionAddOns ?? []).some((value) => value === regionKey);
}

const SHARED_MONTHLY_CAP = 4;
const SHARED_SPECIAL_MONTHLY_CAP = 8;
const SHARED_SPECIAL_WEEKLY_CAP = 2;

function finiteNumber(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function resolveMonthlyCap(conditions: Record<string, unknown>, context: BillingEvidenceContext) {
  if (context.specialCapEligible) {
    return (
      finiteNumber(conditions.special_monthly_cap) ??
      (conditions.monthly_cap_shared === true ? SHARED_SPECIAL_MONTHLY_CAP : null)
    );
  }

  return (
    finiteNumber(conditions.monthly_cap) ??
    (conditions.monthly_cap_shared === true ? SHARED_MONTHLY_CAP : null)
  );
}

function resolveWeeklyCap(conditions: Record<string, unknown>, context: BillingEvidenceContext) {
  if (context.specialCapEligible) {
    return (
      finiteNumber(conditions.special_weekly_cap) ??
      (conditions.monthly_cap_shared === true ? SHARED_SPECIAL_WEEKLY_CAP : null)
    );
  }

  return finiteNumber(conditions.weekly_pharmacist_cap);
}

export async function getHomeCareBillingSsotSummary(tx: Tx, orgId: string, asOfDate?: Date) {
  const targetDate = asOfDate ?? new Date();
  const now = new Date(
    Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate()),
  );

  const [matrix, rules] = await Promise.all([
    tx.sourceOfTruthMatrix.findFirst({
      where: {
        org_id: orgId,
        entity_type: 'billing',
      },
    }),
    tx.billingRule.findMany({
      where: {
        org_id: orgId,
        billing_scope: 'home_care_ssot',
        is_active: true,
        OR: [{ effective_from: null }, { effective_from: { lte: now } }],
        AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: now } }] }],
      },
      orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
    }),
  ]);

  return {
    source: matrix,
    rules,
  };
}

function chooseBaseRule(
  rules: Awaited<ReturnType<typeof getHomeCareBillingSsotSummary>>['rules'],
  context: BillingEvidenceContext,
) {
  // 緊急訪問は算定区分が監査上の根拠になるため、欠落時は fee2 へ推定しない。
  if (context.visitType === 'emergency') {
    if (context.emergencyCategory == null) return null;
    const targetEmergencyCategory = context.emergencyCategory;
    return (
      rules.find((rule) => {
        if (rule.rule_type !== 'base') return false;
        if (rule.payer_basis !== 'medical') return false;
        return (
          conditionValue(rule, 'visit_type') === 'emergency' &&
          conditionValue(rule, 'emergency_category') === targetEmergencyCategory
        );
      }) ?? null
    );
  }

  const onlineRule = context.onlineEligible
    ? (rules.find((rule) => {
        if (rule.rule_type !== 'base') return false;
        if (rule.service_type !== context.serviceType) return false;
        if (rule.payer_basis !== context.payerBasis) return false;
        if (rule.provider_scope && rule.provider_scope !== context.providerScope) return false;
        return conditionValue(rule, 'requires_online_visit') === true;
      }) ?? null)
    : null;

  if (onlineRule) return onlineRule;

  const tier = buildingTier(context.buildingPatientCount);
  return (
    rules.find((rule) => {
      if (rule.rule_type !== 'base') return false;
      if (rule.service_type !== context.serviceType) return false;
      if (rule.payer_basis !== context.payerBasis) return false;
      if (rule.provider_scope && rule.provider_scope !== context.providerScope) return false;
      if (conditionValue(rule, 'requires_online_visit') === true) return false;
      if (conditionValue(rule, 'visit_type') === 'emergency') return false;
      return conditionValue(rule, 'building_tier') === tier;
    }) ?? null
  );
}

function manualRuleCandidates(
  rules: Awaited<ReturnType<typeof getHomeCareBillingSsotSummary>>['rules'],
  context: BillingEvidenceContext,
) {
  if (context.visitType === 'emergency' && context.emergencyCategory == null) return [];

  return rules.filter((rule) => {
    const conditions = readRuleConditions(rule);
    if (rule.service_type !== context.serviceType && rule.service_type !== 'generic') return false;
    if (rule.payer_basis !== context.payerBasis) return false;
    if (rule.provider_scope && rule.provider_scope !== context.providerScope) return false;
    if (
      typeof conditions.adverse_event_prevention_type === 'string' ||
      typeof conditions.residual_adjustment_type === 'string' ||
      conditions.requires_residual_adjustment_home === true
    ) {
      return false;
    }
    // Exclude emergency rules from manual candidates for non-emergency visits
    if (conditions.visit_type === 'emergency' && context.visitType !== 'emergency') return false;
    if (rule.rule_type === 'base') {
      // For emergency visits, include emergency_visit.1 as manual upgrade option
      if (context.visitType === 'emergency') {
        return (
          conditions.visit_type === 'emergency' &&
          conditions.emergency_category !== 'other_exacerbation'
        );
      }
      return conditions.requires_online_visit === true;
    }
    return true;
  });
}

export async function buildBillingCandidateSpecs(
  tx: Tx,
  context: BillingEvidenceContext,
): Promise<BillingCandidateSpec[]> {
  await ensureHomeCareBillingSsot(tx, context.orgId, {
    asOfDate: context.asOfDate,
  });
  const { rules } = await getHomeCareBillingSsotSummary(tx, context.orgId, context.asOfDate);

  const specs: BillingCandidateSpec[] = [];
  const baseRule = chooseBaseRule(rules, context);
  const tier = buildingTier(context.buildingPatientCount);

  if (baseRule) {
    let exclusionReason: string | null = null;
    const conditions = readRuleConditions(baseRule);
    const monthlyCap = resolveMonthlyCap(conditions, context);
    const weeklyCap = resolveWeeklyCap(conditions, context);

    if (!context.claimable) {
      exclusionReason = context.exclusionReason ?? '請求根拠の確認が必要です';
    } else if (monthlyCap != null && context.monthlyVisitCount > monthlyCap) {
      exclusionReason = `月内算定上限を超過しています（${context.monthlyVisitCount}/${monthlyCap}）`;
    } else if (weeklyCap != null && context.weeklyVisitCount > weeklyCap) {
      exclusionReason = `週内算定上限を超過しています（${context.weeklyVisitCount}/${weeklyCap}）`;
    }

    specs.push({
      ssotKey: baseRule.ssot_key ?? baseRule.code ?? baseRule.id,
      code: baseRule.code ?? baseRule.id,
      name: baseRule.name,
      status: exclusionReason ? 'excluded' : 'confirmed',
      points: baseRule.amount,
      exclusionReason,
      calculationBreakdown: {
        calculation_unit: baseRule.calculation_unit,
        building_patient_count: context.buildingPatientCount,
        building_tier: tier,
        online_eligible: context.onlineEligible,
        emergency_category: context.emergencyCategory,
        monthly_visit_count: context.monthlyVisitCount,
        weekly_visit_count: context.weeklyVisitCount,
        monthly_cap: monthlyCap,
        weekly_cap: weeklyCap,
        monthly_cap_shared: conditions.monthly_cap_shared === true,
      },
      sourceSnapshot: {
        billing_scope: baseRule.billing_scope,
        source_url: baseRule.source_url,
        source_note: baseRule.source_note,
        selection_mode: baseRule.selection_mode,
        ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
      },
    });
  }

  for (const manualRule of manualRuleCandidates(rules, context)) {
    const conditions = readRuleConditions(manualRule);
    const regionKey = String(conditions.region_add_on ?? '');
    const requiresOnline = conditions.requires_online_visit === true;
    const afterHoursVisit = (conditions.after_hours_visit as string | undefined) ?? null;
    const manualRuleBuildingTier = (conditions.building_tier as string | undefined) ?? null;
    // 患者データから自動判定された条件でフィルタリング
    const narcoticMatch =
      conditions.requires_narcotic_management !== true || context.narcoticRequired === true;
    const narcoticPrescriptionMatch =
      conditions.requires_narcotic_prescription !== true || context.narcoticRequired === true;
    const narcoticInjectionMatch =
      conditions.requires_narcotic_continuous_injection !== true ||
      context.narcoticInjectionRequired === true;
    const centralVenousMatch =
      conditions.requires_central_venous_nutrition !== true ||
      context.centralVenousRequired === true;
    const infantMatch =
      conditions.requires_infant_eligibility !== true || context.infantEligible === true;
    const pediatricMatch =
      conditions.requires_pediatric_special_eligibility !== true || context.pediatricAge === true;
    const enteralMatch =
      conditions.requires_enteral_feeding !== true || context.enteralRequired === true;
    const initialTransitionMatch =
      conditions.requires_initial_transition !== true || context.initialTransitionEligible === true;
    const specialCapMatch =
      conditions.special_cap_eligible !== true || context.specialCapEligible === true;
    const multiStaffVisitMatch =
      conditions.requires_multi_staff_visit !== true || context.multiStaffVisitEligible === true;
    const physicianSimultaneousMatch =
      conditions.requires_physician_simultaneous !== true ||
      context.physicianSimultaneousEligible === true;
    const kakaritsukePharmacistMatch =
      conditions.requires_kakaritsuke_pharmacist !== true ||
      context.kakaritsukePharmacistEligible === true;
    const kakaritsukeVisitMatch =
      conditions.requires_kakaritsuke_visit !== true || context.kakaritsukeVisitEligible === true;
    const kakaritsukeFollowupMatch =
      conditions.requires_kakaritsuke_followup !== true ||
      context.kakaritsukeFollowupEligible === true;
    const medicationAdjustmentSupport2Match =
      conditions.requires_medication_adjustment_support2 !== true ||
      context.medicationAdjustmentSupport2Eligible === true;
    const requiredFacilityStandard =
      typeof conditions.facility_standard_required === 'string'
        ? conditions.facility_standard_required
        : null;
    const facilityStandardMatch =
      requiredFacilityStandard == null ||
      context.facilityStandards?.[requiredFacilityStandard] === true;
    const buildingTierMatch = manualRuleBuildingTier == null || manualRuleBuildingTier === tier;
    const patientConditionsMet =
      narcoticMatch &&
      narcoticPrescriptionMatch &&
      narcoticInjectionMatch &&
      centralVenousMatch &&
      infantMatch &&
      pediatricMatch &&
      enteralMatch &&
      initialTransitionMatch &&
      specialCapMatch &&
      multiStaffVisitMatch &&
      physicianSimultaneousMatch &&
      kakaritsukePharmacistMatch &&
      kakaritsukeVisitMatch &&
      kakaritsukeFollowupMatch &&
      medicationAdjustmentSupport2Match &&
      facilityStandardMatch &&
      buildingTierMatch;

    const suggested =
      patientConditionsMet &&
      (regionKey.length === 0 || hasRegionAddOn(context.regionAddOnEligible, regionKey)) &&
      (!requiresOnline || context.onlineEligible) &&
      (afterHoursVisit == null || context.afterHoursVisit === afterHoursVisit);

    const ratePercent = manualRule.calculation_unit === 'percent' ? manualRule.amount : null;
    const derivedPoints =
      ratePercent != null && baseRule
        ? Math.round((baseRule.amount * ratePercent) / 100)
        : manualRule.amount;

    specs.push({
      ssotKey: manualRule.ssot_key ?? manualRule.code ?? manualRule.id,
      code: manualRule.code ?? manualRule.id,
      name: manualRule.name,
      status: context.claimable && suggested ? 'candidate' : 'excluded',
      points: derivedPoints,
      exclusionReason:
        context.claimable && suggested
          ? 'SSOT上の追加算定候補です。要件確認後に採否を確定してください'
          : context.claimable && !facilityStandardMatch && requiredFacilityStandard
            ? `薬局施設基準 ${requiredFacilityStandard} が未届出のため候補化しません`
            : (context.exclusionReason ?? '基礎算定が成立していないため候補化しません'),
      calculationBreakdown: {
        calculation_unit: manualRule.calculation_unit,
        rate_percent: ratePercent,
        base_points: baseRule?.amount ?? null,
        derived_points: derivedPoints,
        conditions,
      },
      sourceSnapshot: {
        billing_scope: manualRule.billing_scope,
        source_url: manualRule.source_url,
        source_note: manualRule.source_note,
        selection_mode: manualRule.selection_mode,
        ruleset_version: HOME_CARE_BILLING_RULESET_VERSION,
      },
    });
  }

  return specs;
}
