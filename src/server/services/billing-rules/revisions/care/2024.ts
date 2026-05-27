import type { BillingRevision, BillingRuleSeed } from '../../types';

export const CARE_REVISION: BillingRevision = {
  code: '2024',
  label: '令和6年度 介護報酬改定',
  effectiveFrom: new Date('2024-06-01'),
  effectiveTo: null,
  source: 'https://www.mhlw.go.jp/stf/newpage_38790.html',
  status: 'confirmed',
};

const CARE_SOURCE_URL = 'https://www.mhlw.go.jp/stf/newpage_38790.html';
const CARE_NOTICE_URL = 'https://www.mhlw.go.jp/content/12404000/1.pdf';

export const CARE_RULES_2024: BillingRuleSeed[] = [
  // ════════════════════════════════════════════════════════════════
  // 居宅療養管理指導費（要介護） — 薬局薬剤師
  // 月4回まで（末期悪性腫瘍/麻薬注射/中心静脈栄養: 週2回・月8回）
  // ════════════════════════════════════════════════════════════════
  {
    ssot_key: 'care.home_management.pharmacy.single',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 200,
    name: '居宅療養管理指導費 薬局薬剤師 単一建物1人',
    code: 'CARE_HOME_PHARMACY_SINGLE',
    amount: 518,
    conditions: {
      building_tier: 'single',
      care_level_category: 'care_required',
      monthly_cap: 4,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    exclusion_rules: {
      same_month_exclusive: [
        'MED_HOME_VISIT_SINGLE',
        'MED_HOME_VISIT_MULTI_2_9',
        'MED_HOME_VISIT_MULTI_10_PLUS',
        'MED_HOME_VISIT_ONLINE',
      ],
    },
    source_url: CARE_NOTICE_URL,
    source_note: '居宅療養管理指導費 薬局薬剤師 単一建物1人 518単位（令和6年改定: 517→518）',
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
    name: '居宅療養管理指導費 薬局薬剤師 単一建物2〜9人',
    code: 'CARE_HOME_PHARMACY_MULTI_2_9',
    amount: 379,
    conditions: {
      building_tier: 'multi_2_9',
      care_level_category: 'care_required',
      monthly_cap: 4,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    exclusion_rules: {
      same_month_exclusive: [
        'MED_HOME_VISIT_SINGLE',
        'MED_HOME_VISIT_MULTI_2_9',
        'MED_HOME_VISIT_MULTI_10_PLUS',
        'MED_HOME_VISIT_ONLINE',
      ],
    },
    source_url: CARE_NOTICE_URL,
    source_note: '居宅療養管理指導費 薬局薬剤師 単一建物2〜9人 379単位（令和6年改定: 378→379）',
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
    name: '居宅療養管理指導費 薬局薬剤師 単一建物10人以上',
    code: 'CARE_HOME_PHARMACY_MULTI_10_PLUS',
    amount: 342,
    conditions: {
      building_tier: 'multi_10_plus',
      care_level_category: 'care_required',
      monthly_cap: 4,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    exclusion_rules: {
      same_month_exclusive: [
        'MED_HOME_VISIT_SINGLE',
        'MED_HOME_VISIT_MULTI_2_9',
        'MED_HOME_VISIT_MULTI_10_PLUS',
        'MED_HOME_VISIT_ONLINE',
      ],
    },
    source_url: CARE_NOTICE_URL,
    source_note: '令和6年厚生労働省告示第86号（2024年3月15日）社保審-介護給付費分科会 第239回 参考資料2-1 p.5 改定前341→改定後342単位',
  },

  // ════════════════════════════════════════════════════════════════
  // NOTE: 病院・診療所薬剤師の居宅療養管理指導費 (558/414/378単位) は
  // 保険薬局の責務外のため除外。PH-OS は保険薬局向けシステム。
  // ════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════
  // 介護予防居宅療養管理指導費（要支援） — 薬局薬剤師
  // 単位数は居宅療養管理指導費と同額
  // ════════════════════════════════════════════════════════════════
  {
    ssot_key: 'care.prevention.pharmacy.single',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 260,
    name: '介護予防居宅療養管理指導費 薬局薬剤師 単一建物1人',
    code: 'CARE_PREV_PHARMACY_SINGLE',
    amount: 518,
    conditions: {
      building_tier: 'single',
      care_level_category: 'support_required',
      monthly_cap: 4,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    exclusion_rules: {
      same_month_exclusive: [
        'MED_HOME_VISIT_SINGLE',
        'MED_HOME_VISIT_MULTI_2_9',
        'MED_HOME_VISIT_MULTI_10_PLUS',
        'MED_HOME_VISIT_ONLINE',
      ],
    },
    source_url: CARE_NOTICE_URL,
    source_note: '介護予防居宅療養管理指導費 薬局薬剤師 単一建物1人 518単位',
  },
  {
    ssot_key: 'care.prevention.pharmacy.multi_2_9',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 270,
    name: '介護予防居宅療養管理指導費 薬局薬剤師 単一建物2〜9人',
    code: 'CARE_PREV_PHARMACY_MULTI_2_9',
    amount: 379,
    conditions: {
      building_tier: 'multi_2_9',
      care_level_category: 'support_required',
      monthly_cap: 4,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    exclusion_rules: {
      same_month_exclusive: [
        'MED_HOME_VISIT_SINGLE',
        'MED_HOME_VISIT_MULTI_2_9',
        'MED_HOME_VISIT_MULTI_10_PLUS',
        'MED_HOME_VISIT_ONLINE',
      ],
    },
    source_url: CARE_NOTICE_URL,
    source_note: '介護予防居宅療養管理指導費 薬局薬剤師 単一建物2〜9人 379単位',
  },
  {
    ssot_key: 'care.prevention.pharmacy.multi_10_plus',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 280,
    name: '介護予防居宅療養管理指導費 薬局薬剤師 単一建物10人以上',
    code: 'CARE_PREV_PHARMACY_MULTI_10_PLUS',
    amount: 342,
    conditions: {
      building_tier: 'multi_10_plus',
      care_level_category: 'support_required',
      monthly_cap: 4,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
      requires_care_manager_report: true,
    },
    evidence_requirements: {
      requires_care_manager_report: true,
      requires_medication_management_record: true,
    },
    exclusion_rules: {
      same_month_exclusive: [
        'MED_HOME_VISIT_SINGLE',
        'MED_HOME_VISIT_MULTI_2_9',
        'MED_HOME_VISIT_MULTI_10_PLUS',
        'MED_HOME_VISIT_ONLINE',
      ],
    },
    source_url: CARE_NOTICE_URL,
    source_note: '令和6年厚生労働省告示第86号（2024年3月15日）社保審-介護給付費分科会 第239回 参考資料2-1 p.5 改定前341→改定後342単位',
  },

  // ════════════════════════════════════════════════════════════════
  // オンライン薬剤管理指導（情報通信機器を用いた場合）
  // 月4回まで（居宅療養管理指導・介護予防 共通）
  // ════════════════════════════════════════════════════════════════
  {
    ssot_key: 'care.home_management.pharmacy.online',
    rule_type: 'base',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'unit',
    display_order: 290,
    name: '居宅療養管理指導 薬局薬剤師 情報通信機器（オンライン）',
    code: 'CARE_HOME_PHARMACY_ONLINE',
    amount: 46,
    conditions: {
      requires_online_visit: true,
      monthly_cap_shared: true,
      special_monthly_cap: 8,
      special_weekly_cap: 2,
    },
    source_url: CARE_NOTICE_URL,
    source_note: '居宅療養管理指導 薬局薬剤師 情報通信機器を用いた場合 46単位/回（月4回まで）',
  },

  // ════════════════════════════════════════════════════════════════
  // 地域加算
  // ════════════════════════════════════════════════════════════════
  {
    ssot_key: 'care.addition.special_region_15',
    rule_type: 'regional_addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'percent',
    display_order: 500,
    name: '特別地域加算',
    code: 'CARE_REGION_SPECIAL_15',
    amount: 15,
    conditions: {
      region_add_on: 'special_15',
    },
    source_url: CARE_SOURCE_URL,
    source_note: '特別地域加算 15%',
  },
  {
    ssot_key: 'care.addition.small_office_10',
    rule_type: 'regional_addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'percent',
    display_order: 510,
    name: '中山間地域等における小規模事業所加算',
    code: 'CARE_REGION_SMALL_OFFICE_10',
    amount: 10,
    conditions: {
      region_add_on: 'small_office_10',
    },
    source_url: CARE_SOURCE_URL,
    source_note: '中山間地域等における小規模事業所加算 10%',
  },
  {
    ssot_key: 'care.addition.resident_5',
    rule_type: 'regional_addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'percent',
    display_order: 520,
    name: '中山間地域等に居住する者へのサービス提供加算',
    code: 'CARE_REGION_RESIDENT_5',
    amount: 5,
    conditions: {
      region_add_on: 'resident_5',
    },
    source_url: CARE_SOURCE_URL,
    source_note: '中山間地域等に居住する者へのサービス提供加算 5%',
  },

  // ════════════════════════════════════════════════════════════════
  // 臨床加算（居宅療養管理指導・介護予防 共通）
  // ════════════════════════════════════════════════════════════════
  {
    ssot_key: 'care.addition.narcotic_management',
    rule_type: 'addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 600,
    name: '麻薬管理指導加算',
    code: 'CARE_ADD_NARCOTIC',
    amount: 100,
    conditions: {
      requires_narcotic_prescription: true,
      exclusive_with: ['CARE_ADD_NARCOTIC_INJECTION'],
    },
    evidence_requirements: {
      narcotic_management_record: true,
      narcotic_dealer_license: true,
    },
    source_url: CARE_SOURCE_URL,
    source_note: '麻薬管理指導加算 100単位/回（疼痛緩和の特別薬剤。医療用麻薬持続注射療法加算との併算定不可）',
  },
  {
    ssot_key: 'care.addition.narcotic_continuous_injection',
    rule_type: 'addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 610,
    name: '医療用麻薬持続注射療法加算',
    code: 'CARE_ADD_NARCOTIC_INJECTION',
    amount: 250,
    conditions: {
      requires_narcotic_continuous_injection: true,
      special_cap_eligible: true,
      exclusive_with: ['CARE_ADD_NARCOTIC'],
    },
    evidence_requirements: {
      narcotic_injection_management_record: true,
      narcotic_dealer_license: true,
      high_care_medical_device_license: true,
    },
    source_url: CARE_SOURCE_URL,
    source_note: '医療用麻薬持続注射療法加算 250単位/回（令和6年新設。麻薬管理指導加算との併算定不可。高度管理医療機器販売業許可要）',
  },
  {
    ssot_key: 'care.addition.central_venous_nutrition',
    rule_type: 'addition',
    service_type: 'care_home_management',
    payer_basis: 'care',
    provider_scope: 'pharmacy',
    selection_mode: 'auto',
    calculation_unit: 'unit',
    display_order: 620,
    name: '在宅中心静脈栄養法加算',
    code: 'CARE_ADD_CENTRAL_VENOUS',
    amount: 150,
    conditions: {
      requires_central_venous_nutrition: true,
      special_cap_eligible: true,
    },
    evidence_requirements: {
      central_venous_management_record: true,
      high_care_medical_device_license: true,
    },
    source_url: CARE_SOURCE_URL,
    source_note: '在宅中心静脈栄養法加算 150単位/回（令和6年新設。高度管理医療機器販売業許可要）',
  },
];
