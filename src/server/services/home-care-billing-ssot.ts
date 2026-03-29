import { Prisma, type PayerBasis } from '@prisma/client';

type Tx = Prisma.TransactionClient;

type BillingRuleSeed = {
  ssot_key: string;
  rule_type: string;
  service_type: 'medical_home_visit' | 'care_home_management' | 'generic';
  payer_basis: PayerBasis;
  provider_scope: string | null;
  selection_mode: 'auto' | 'manual';
  calculation_unit: 'point' | 'unit' | 'percent';
  display_order: number;
  name: string;
  code: string;
  amount: number;
  conditions: Record<string, unknown>;
  evidence_requirements?: Record<string, unknown>;
  source_url: string;
  source_note: string;
};

export type BillingEvidenceContext = {
  orgId: string;
  payerBasis: PayerBasis;
  serviceType: 'medical_home_visit' | 'care_home_management';
  providerScope: 'pharmacy' | 'hospital_clinic';
  buildingPatientCount: number;
  monthlyVisitCount: number;
  weeklyVisitCount: number;
  claimable: boolean;
  exclusionReason?: string | null;
  specialCapEligible?: boolean;
  onlineEligible?: boolean;
  regionAddOnEligible?: Array<'special_15' | 'small_office_10' | 'resident_5'>;
  /** VisitType from the schedule — drives emergency billing rule selection */
  visitType?: string | null;
};

export type BillingCandidateSpec = {
  ssotKey: string;
  code: string;
  name: string;
  status: 'candidate' | 'confirmed' | 'excluded';
  points: number | null;
  exclusionReason: string | null;
  calculationBreakdown: Record<string, unknown>;
  sourceSnapshot: Record<string, unknown>;
};

export const HOME_CARE_BILLING_RULESET_VERSION = '2026-revision-v1';

const MEDICAL_SOURCE_URL =
  'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000188411_00045.html';
const MEDICAL_TABLE_URL = 'https://www.mhlw.go.jp/content/12404000/001218733.pdf';
const CARE_SOURCE_URL = 'https://www.mhlw.go.jp/stf/newpage_38790.html';
const CARE_NOTICE_URL = 'https://www.mhlw.go.jp/content/12404000/1.pdf';

const OFFICIAL_HOME_CARE_RULES: BillingRuleSeed[] = [
  {
    ssot_key: 'medical.home_visit.single',
    rule_type: 'base',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'point',
    display_order: 10,
    name: '在宅患者訪問薬剤管理指導料 単一建物1人',
    code: 'MED_HOME_VISIT_SINGLE',
    amount: 650,
    conditions: {
      building_tier: 'single',
      monthly_cap: 4,
      weekly_pharmacist_cap: 40,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
    },
    evidence_requirements: {
      requires_physician_instruction: true,
      requires_management_plan: true,
      requires_visit_documentation: true,
      requires_written_report: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: `厚労省 令和6年度診療報酬改定 在宅患者訪問薬剤管理指導料（単一建物1人 ${650}点）`,
  },
  {
    ssot_key: 'medical.home_visit.multi_2_9',
    rule_type: 'base',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'point',
    display_order: 20,
    name: '在宅患者訪問薬剤管理指導料 単一建物2〜9人',
    code: 'MED_HOME_VISIT_MULTI_2_9',
    amount: 320,
    conditions: {
      building_tier: 'multi_2_9',
      monthly_cap: 4,
      weekly_pharmacist_cap: 40,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
    },
    evidence_requirements: {
      requires_physician_instruction: true,
      requires_management_plan: true,
      requires_visit_documentation: true,
      requires_written_report: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: `厚労省 令和6年度診療報酬改定 在宅患者訪問薬剤管理指導料（単一建物2〜9人 ${320}点）`,
  },
  {
    ssot_key: 'medical.home_visit.multi_10_plus',
    rule_type: 'base',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'point',
    display_order: 30,
    name: '在宅患者訪問薬剤管理指導料 単一建物10人以上',
    code: 'MED_HOME_VISIT_MULTI_10_PLUS',
    amount: 290,
    conditions: {
      building_tier: 'multi_10_plus',
      monthly_cap: 4,
      weekly_pharmacist_cap: 40,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
    },
    evidence_requirements: {
      requires_physician_instruction: true,
      requires_management_plan: true,
      requires_visit_documentation: true,
      requires_written_report: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: `厚労省 令和6年度診療報酬改定 在宅患者訪問薬剤管理指導料（単一建物10人以上 ${290}点）`,
  },
  {
    ssot_key: 'medical.home_visit.online',
    rule_type: 'base',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 40,
    name: '在宅患者オンライン薬剤管理指導料',
    code: 'MED_HOME_VISIT_ONLINE',
    amount: 59,
    conditions: {
      requires_online_visit: true,
      monthly_cap_shared: true,
      weekly_pharmacist_cap: 40,
    },
    source_url: MEDICAL_SOURCE_URL,
    source_note: '厚労省 令和6年度診療報酬改定 在宅患者オンライン薬剤管理指導料 59点',
  },
  {
    ssot_key: 'medical.addition.narcotic',
    rule_type: 'addition',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 100,
    name: '麻薬管理指導加算',
    code: 'MED_ADD_NARCOTIC',
    amount: 100,
    conditions: {
      requires_narcotic_management: true,
    },
    source_url: MEDICAL_SOURCE_URL,
    source_note: '厚労省 令和6年度診療報酬改定 麻薬管理指導加算 100点',
  },
  {
    ssot_key: 'medical.addition.narcotic_online',
    rule_type: 'addition',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 110,
    name: '麻薬管理指導加算（オンライン）',
    code: 'MED_ADD_NARCOTIC_ONLINE',
    amount: 22,
    conditions: {
      requires_online_visit: true,
      requires_narcotic_management: true,
    },
    source_url: MEDICAL_SOURCE_URL,
    source_note: '厚労省 令和6年度診療報酬改定 麻薬管理指導加算（オンライン）22点',
  },
  {
    ssot_key: 'medical.addition.continuous_narcotic_infusion',
    rule_type: 'addition',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 120,
    name: '在宅患者医療用麻薬持続注射療法加算',
    code: 'MED_ADD_CONTINUOUS_NARCOTIC',
    amount: 250,
    conditions: {
      requires_continuous_narcotic_infusion: true,
      special_cap_eligible: true,
    },
    source_url: MEDICAL_SOURCE_URL,
    source_note: '厚労省 令和6年度診療報酬改定 在宅患者医療用麻薬持続注射療法加算 250点',
  },
  {
    ssot_key: 'medical.addition.infant',
    rule_type: 'addition',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 130,
    name: '乳幼児加算',
    code: 'MED_ADD_INFANT',
    amount: 100,
    conditions: {
      requires_infant_eligibility: true,
    },
    source_url: MEDICAL_SOURCE_URL,
    source_note: '厚労省 令和6年度診療報酬改定 乳幼児加算 100点',
  },
  {
    ssot_key: 'medical.addition.infant_online',
    rule_type: 'addition',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 140,
    name: '乳幼児加算（オンライン）',
    code: 'MED_ADD_INFANT_ONLINE',
    amount: 12,
    conditions: {
      requires_online_visit: true,
      requires_infant_eligibility: true,
    },
    source_url: MEDICAL_SOURCE_URL,
    source_note: '厚労省 令和6年度診療報酬改定 乳幼児加算（オンライン）12点',
  },
  {
    ssot_key: 'medical.addition.pediatric_special',
    rule_type: 'addition',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 150,
    name: '小児特定加算',
    code: 'MED_ADD_PEDIATRIC_SPECIAL',
    amount: 450,
    conditions: {
      requires_pediatric_special_eligibility: true,
    },
    source_url: MEDICAL_SOURCE_URL,
    source_note: '厚労省 令和6年度診療報酬改定 小児特定加算 450点',
  },
  {
    ssot_key: 'care.home_management.pharmacy.single',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 200,
    name: '居宅療養管理指導 薬局薬剤師 単一建物1人',
    code: 'CARE_HOME_PHARMACY_SINGLE',
    amount: 507,
    conditions: {
      building_tier: 'single',
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    source_url: CARE_NOTICE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 居宅療養管理指導 薬局薬剤師 単一建物1人 507単位',
  },
  {
    ssot_key: 'care.home_management.pharmacy.multi_2_9',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 210,
    name: '居宅療養管理指導 薬局薬剤師 単一建物2〜9人',
    code: 'CARE_HOME_PHARMACY_MULTI_2_9',
    amount: 376,
    conditions: {
      building_tier: 'multi_2_9',
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    source_url: CARE_NOTICE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 居宅療養管理指導 薬局薬剤師 単一建物2〜9人 376単位',
  },
  {
    ssot_key: 'care.home_management.pharmacy.multi_10_plus',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 220,
    name: '居宅療養管理指導 薬局薬剤師 単一建物10人以上',
    code: 'CARE_HOME_PHARMACY_MULTI_10_PLUS',
    amount: 344,
    conditions: {
      building_tier: 'multi_10_plus',
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    source_url: CARE_NOTICE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 居宅療養管理指導 薬局薬剤師 単一建物10人以上 344単位',
  },
  {
    ssot_key: 'care.home_management.hospital.single',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'hospital_clinic',
    selection_mode: 'manual',
    calculation_unit: 'unit',
    display_order: 230,
    name: '居宅療養管理指導 病院・診療所薬剤師 単一建物1人',
    code: 'CARE_HOME_HOSPITAL_SINGLE',
    amount: 558,
    conditions: {
      building_tier: 'single',
    },
    source_url: CARE_NOTICE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 居宅療養管理指導 病院・診療所薬剤師 単一建物1人 558単位',
  },
  {
    ssot_key: 'care.home_management.hospital.multi_2_9',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'hospital_clinic',
    selection_mode: 'manual',
    calculation_unit: 'unit',
    display_order: 240,
    name: '居宅療養管理指導 病院・診療所薬剤師 単一建物2〜9人',
    code: 'CARE_HOME_HOSPITAL_MULTI_2_9',
    amount: 414,
    conditions: {
      building_tier: 'multi_2_9',
    },
    source_url: CARE_NOTICE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 居宅療養管理指導 病院・診療所薬剤師 単一建物2〜9人 414単位',
  },
  {
    ssot_key: 'care.home_management.hospital.multi_10_plus',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'hospital_clinic',
    selection_mode: 'manual',
    calculation_unit: 'unit',
    display_order: 250,
    name: '居宅療養管理指導 病院・診療所薬剤師 単一建物10人以上',
    code: 'CARE_HOME_HOSPITAL_MULTI_10_PLUS',
    amount: 378,
    conditions: {
      building_tier: 'multi_10_plus',
    },
    source_url: CARE_NOTICE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 居宅療養管理指導 病院・診療所薬剤師 単一建物10人以上 378単位',
  },
  {
    ssot_key: 'care.addition.special_region_15',
    rule_type: 'regional_addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'percent',
    display_order: 300,
    name: '特別地域加算',
    code: 'CARE_REGION_SPECIAL_15',
    amount: 15,
    conditions: {
      region_add_on: 'special_15',
    },
    source_url: CARE_SOURCE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 特別地域加算 15%',
  },
  {
    ssot_key: 'care.addition.small_office_10',
    rule_type: 'regional_addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'percent',
    display_order: 310,
    name: '中山間地域等における小規模事業所加算',
    code: 'CARE_REGION_SMALL_OFFICE_10',
    amount: 10,
    conditions: {
      region_add_on: 'small_office_10',
    },
    source_url: CARE_SOURCE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 中山間地域等における小規模事業所加算 10%',
  },
  {
    ssot_key: 'care.addition.resident_5',
    rule_type: 'regional_addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'percent',
    display_order: 320,
    name: '中山間地域等に居住する者へのサービス提供加算',
    code: 'CARE_REGION_RESIDENT_5',
    amount: 5,
    conditions: {
      region_add_on: 'resident_5',
    },
    source_url: CARE_SOURCE_URL,
    source_note: '厚労省 令和6年度介護報酬改定 中山間地域等に居住する者へのサービス提供加算 5%',
  },
  {
    ssot_key: 'medical.information_provision.1',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 400,
    name: '服薬情報等提供料1',
    code: 'MED_INFO_PROVISION_1',
    amount: 30,
    conditions: {
      information_provision_type: '1',
      requested_by_medical_institution: true,
      frequency_limit: 'monthly_once',
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の5 服薬情報等提供料1 30点',
  },
  {
    ssot_key: 'medical.information_provision.2_medical',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 410,
    name: '服薬情報等提供料2 イ',
    code: 'MED_INFO_PROVISION_2_I',
    amount: 20,
    conditions: {
      information_provision_type: '2_i',
      target: 'medical_institution',
      frequency_limit: 'monthly_once',
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の5 服薬情報等提供料2 イ 20点',
  },
  {
    ssot_key: 'medical.information_provision.2_refill',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 420,
    name: '服薬情報等提供料2 ロ',
    code: 'MED_INFO_PROVISION_2_RO',
    amount: 20,
    conditions: {
      information_provision_type: '2_ro',
      target: 'prescriber',
      refill_followup: true,
      frequency_limit: 'monthly_once',
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の5 服薬情報等提供料2 ロ 20点',
  },
  {
    ssot_key: 'medical.information_provision.2_care_manager',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 430,
    name: '服薬情報等提供料2 ハ',
    code: 'MED_INFO_PROVISION_2_HA',
    amount: 20,
    conditions: {
      information_provision_type: '2_ha',
      target: 'care_manager',
      same_month_home_management_disallowed: true,
      frequency_limit: 'monthly_once',
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の5 服薬情報等提供料2 ハ 20点',
  },
  {
    ssot_key: 'medical.information_provision.3',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 440,
    name: '服薬情報等提供料3',
    code: 'MED_INFO_PROVISION_3',
    amount: 50,
    conditions: {
      information_provision_type: '3',
      pre_admission_medication_reconciliation: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の5 服薬情報等提供料3 50点',
  },
  {
    ssot_key: 'medical.home_duplicate_interaction.change_other',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 450,
    name: '在宅患者重複投薬・相互作用等防止管理料1 イ',
    code: 'MED_HOME_DUPLICATE_CHANGE_OTHER',
    amount: 40,
    conditions: {
      duplicate_interaction_type: '1_i',
      residual_adjustment: false,
      requires_prescription_change: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の6 在宅患者重複投薬・相互作用等防止管理料1 イ 40点',
  },
  {
    ssot_key: 'medical.home_duplicate_interaction.change_residual',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 460,
    name: '在宅患者重複投薬・相互作用等防止管理料1 ロ',
    code: 'MED_HOME_DUPLICATE_CHANGE_RESIDUAL',
    amount: 20,
    conditions: {
      duplicate_interaction_type: '1_ro',
      residual_adjustment: true,
      requires_prescription_change: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の6 在宅患者重複投薬・相互作用等防止管理料1 ロ 20点',
  },
  {
    ssot_key: 'medical.home_duplicate_interaction.proposal_other',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 470,
    name: '在宅患者重複投薬・相互作用等防止管理料2 イ',
    code: 'MED_HOME_DUPLICATE_PROPOSAL_OTHER',
    amount: 40,
    conditions: {
      duplicate_interaction_type: '2_i',
      residual_adjustment: false,
      proposal_reflected: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の6 在宅患者重複投薬・相互作用等防止管理料2 イ 40点',
  },
  {
    ssot_key: 'medical.home_duplicate_interaction.proposal_residual',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 480,
    name: '在宅患者重複投薬・相互作用等防止管理料2 ロ',
    code: 'MED_HOME_DUPLICATE_PROPOSAL_RESIDUAL',
    amount: 20,
    conditions: {
      duplicate_interaction_type: '2_ro',
      residual_adjustment: true,
      proposal_reflected: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の6 在宅患者重複投薬・相互作用等防止管理料2 ロ 20点',
  },

  // ── 在宅患者緊急訪問薬剤管理指導料（令和6年度） ──
  // 介護認定の有無に関わらず医療保険で算定。
  // 1: 計画的訪問の対象疾患の急変 500点
  // 2: それ以外の急変 200点
  {
    ssot_key: 'medical.emergency_visit.1',
    rule_type: 'base',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'point',
    display_order: 500,
    name: '在宅患者緊急訪問薬剤管理指導料1',
    code: 'MED_EMERGENCY_VISIT_1',
    amount: 500,
    conditions: {
      visit_type: 'emergency',
      emergency_category: 'planned_disease_exacerbation',
      monthly_cap: 4,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の3 在宅患者緊急訪問薬剤管理指導料1 500点（計画的訪問の対象疾患の急変）',
  },
  {
    ssot_key: 'medical.emergency_visit.2',
    rule_type: 'base',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'point',
    display_order: 510,
    name: '在宅患者緊急訪問薬剤管理指導料2',
    code: 'MED_EMERGENCY_VISIT_2',
    amount: 200,
    conditions: {
      visit_type: 'emergency',
      emergency_category: 'other_exacerbation',
      monthly_cap: 4,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の3 在宅患者緊急訪問薬剤管理指導料2 200点（それ以外の急変）',
  },
  {
    ssot_key: 'medical.emergency_visit.online',
    rule_type: 'base',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'point',
    display_order: 520,
    name: '在宅患者緊急オンライン薬剤管理指導料',
    code: 'MED_EMERGENCY_VISIT_ONLINE',
    amount: 59,
    conditions: {
      visit_type: 'emergency',
      emergency_category: 'online',
      monthly_cap: 4,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '調剤報酬点数表 区分15の3 在宅患者緊急オンライン薬剤管理指導料 59点',
  },
];

function buildingTier(buildingPatientCount: number) {
  if (buildingPatientCount >= 10) return 'multi_10_plus';
  if (buildingPatientCount >= 2) return 'multi_2_9';
  return 'single';
}

function conditionValue(rule: Awaited<ReturnType<typeof getHomeCareBillingSsotSummary>>['rules'][number], key: string) {
  return ((rule.conditions ?? {}) as Record<string, unknown>)[key];
}

function hasRegionAddOn(
  regionAddOns: BillingEvidenceContext['regionAddOnEligible'],
  regionKey: string
) {
  return (regionAddOns ?? []).some((value) => value === regionKey);
}

export async function ensureHomeCareBillingSsot(tx: Tx, orgId: string) {
  await tx.sourceOfTruthMatrix.upsert({
    where: {
      org_id_entity_type: {
        org_id: orgId,
        entity_type: 'billing',
      },
    },
    create: {
      org_id: orgId,
      entity_type: 'billing',
      source_of_truth: 'careviax',
      sync_direction: 'push',
      recovery_procedure: 'BillingRule home_care_ssot を唯一の算定SSOTとして運用',
    },
    update: {
      source_of_truth: 'careviax',
      sync_direction: 'push',
      recovery_procedure: 'BillingRule home_care_ssot を唯一の算定SSOTとして運用',
    },
  });

  for (const rule of OFFICIAL_HOME_CARE_RULES) {
    await tx.billingRule.upsert({
      where: {
        org_id_ssot_key: {
          org_id: orgId,
          ssot_key: rule.ssot_key,
        },
      },
      create: {
        org_id: orgId,
        ssot_key: rule.ssot_key,
        billing_scope: 'home_care_ssot',
        rule_type: rule.rule_type,
        service_type: rule.service_type,
        payer_basis: rule.payer_basis,
        provider_scope: rule.provider_scope,
        selection_mode: rule.selection_mode,
        calculation_unit: rule.calculation_unit,
        display_order: rule.display_order,
        name: rule.name,
        code: rule.code,
        conditions: rule.conditions as Prisma.InputJsonValue,
        evidence_requirements: (rule.evidence_requirements ?? {}) as Prisma.InputJsonValue,
        source_url: rule.source_url,
        source_note: rule.source_note,
        amount: rule.amount,
        is_system: true,
        is_active: true,
      },
      update: {
        billing_scope: 'home_care_ssot',
        rule_type: rule.rule_type,
        service_type: rule.service_type,
        payer_basis: rule.payer_basis,
        provider_scope: rule.provider_scope,
        selection_mode: rule.selection_mode,
        calculation_unit: rule.calculation_unit,
        display_order: rule.display_order,
        name: rule.name,
        code: rule.code,
        conditions: rule.conditions as Prisma.InputJsonValue,
        evidence_requirements: (rule.evidence_requirements ?? {}) as Prisma.InputJsonValue,
        source_url: rule.source_url,
        source_note: rule.source_note,
        amount: rule.amount,
        is_system: true,
      },
    });
  }

  return {
    seeded: OFFICIAL_HOME_CARE_RULES.length,
    medicalSourceUrl: MEDICAL_SOURCE_URL,
    careSourceUrl: CARE_SOURCE_URL,
  };
}

export async function getHomeCareBillingSsotSummary(tx: Tx, orgId: string) {
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
  context: BillingEvidenceContext
) {
  // 緊急訪問 → 在宅患者緊急訪問薬剤管理指導料を優先選択
  // デフォルトは「2」（それ以外の急変 200点）。
  // 「1」（計画的訪問対象疾患の急変 500点）は手動選択で昇格。
  if (context.visitType === 'emergency') {
    return (
      rules.find((rule) => {
        if (rule.rule_type !== 'base') return false;
        if (rule.payer_basis !== 'medical') return false;
        return conditionValue(rule, 'visit_type') === 'emergency' &&
          conditionValue(rule, 'emergency_category') === 'other_exacerbation';
      }) ?? null
    );
  }

  const onlineRule =
    context.onlineEligible
      ? rules.find((rule) => {
          if (rule.rule_type !== 'base') return false;
          if (rule.service_type !== context.serviceType) return false;
          if (rule.payer_basis !== context.payerBasis) return false;
          if (rule.provider_scope && rule.provider_scope !== context.providerScope) return false;
          return conditionValue(rule, 'requires_online_visit') === true;
        }) ?? null
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
  context: BillingEvidenceContext
) {
  return rules.filter((rule) => {
    if (rule.service_type !== context.serviceType && rule.service_type !== 'generic') return false;
    if (rule.payer_basis !== context.payerBasis) return false;
    if (rule.provider_scope && rule.provider_scope !== context.providerScope) return false;
    // Exclude emergency rules from manual candidates for non-emergency visits
    if (conditionValue(rule, 'visit_type') === 'emergency' && context.visitType !== 'emergency') return false;
    if (rule.rule_type === 'base') {
      // For emergency visits, include emergency_visit.1 as manual upgrade option
      if (context.visitType === 'emergency') {
        return conditionValue(rule, 'visit_type') === 'emergency' &&
          conditionValue(rule, 'emergency_category') !== 'other_exacerbation';
      }
      return conditionValue(rule, 'requires_online_visit') === true;
    }
    return true;
  });
}

export async function buildBillingCandidateSpecs(
  tx: Tx,
  context: BillingEvidenceContext
): Promise<BillingCandidateSpec[]> {
  await ensureHomeCareBillingSsot(tx, context.orgId);
  const { rules } = await getHomeCareBillingSsotSummary(tx, context.orgId);

  const specs: BillingCandidateSpec[] = [];
  const baseRule = chooseBaseRule(rules, context);
  const tier = buildingTier(context.buildingPatientCount);

  if (baseRule) {
    let exclusionReason: string | null = null;
    const conditions = (baseRule.conditions ?? {}) as Record<string, unknown>;
    const monthlyCap = Number(
      context.specialCapEligible ? conditions.special_monthly_cap : conditions.monthly_cap
    );
    const weeklyCap = Number(
      context.specialCapEligible ? conditions.special_weekly_cap : conditions.weekly_pharmacist_cap
    );

    if (!context.claimable) {
      exclusionReason = context.exclusionReason ?? '請求根拠の確認が必要です';
    } else if (Number.isFinite(monthlyCap) && context.monthlyVisitCount > monthlyCap) {
      exclusionReason = `月内算定上限を超過しています（${context.monthlyVisitCount}/${monthlyCap}）`;
    } else if (Number.isFinite(weeklyCap) && context.weeklyVisitCount > weeklyCap) {
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
        monthly_visit_count: context.monthlyVisitCount,
        weekly_visit_count: context.weeklyVisitCount,
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
    const conditions = (manualRule.conditions ?? {}) as Record<string, unknown>;
    const regionKey = String(conditions.region_add_on ?? '');
    const requiresOnline = conditions.requires_online_visit === true;
    const suggested =
      (regionKey.length === 0 || hasRegionAddOn(context.regionAddOnEligible, regionKey)) &&
      (!requiresOnline || context.onlineEligible);

    const ratePercent = manualRule.calculation_unit === 'percent' ? manualRule.amount : null;
    const derivedPoints =
      ratePercent != null && baseRule ? Math.round((baseRule.amount * ratePercent) / 100) : manualRule.amount;

    specs.push({
      ssotKey: manualRule.ssot_key ?? manualRule.code ?? manualRule.id,
      code: manualRule.code ?? manualRule.id,
      name: manualRule.name,
      status: context.claimable && suggested ? 'candidate' : 'excluded',
      points: derivedPoints,
      exclusionReason:
        context.claimable && suggested
          ? 'SSOT上の追加算定候補です。要件確認後に採否を確定してください'
          : context.exclusionReason ?? '基礎算定が成立していないため候補化しません',
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
