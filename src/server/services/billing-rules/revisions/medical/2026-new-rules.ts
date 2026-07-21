import type { BillingRuleSeed } from '../../types';

const MEDICAL_TABLE_URL = 'https://www.mhlw.go.jp/content/12400000/001665294.pdf';

export const MEDICAL_NEW_RULES_2026: BillingRuleSeed[] = [
  // ── 複数名薬剤管理指導訪問料 ──
  // 暴力行為等のある患者に対し、医師が必要と認めた場合に複数名の薬剤師で訪問
  {
    ssot_key: 'medical.multi_staff_visit',
    rule_type: 'addition',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 600,
    name: '複数名薬剤管理指導訪問料',
    code: 'MED_MULTI_STAFF_VISIT',
    amount: 300,
    conditions: {
      building_tier: 'single',
      requires_multi_staff_visit: true,
    },
    evidence_requirements: {
      requires_physician_instruction: true,
      requires_visit_documentation: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note: '令和8年度診療報酬改定（2026年6月施行・新設） 複数名薬剤管理指導訪問料 300点',
  },

  // ── 訪問薬剤管理医師同時指導料 ──
  // 医師と薬剤師が同時に訪問しポリファーマシー・残薬対策を実施（6月に1回）
  {
    ssot_key: 'medical.physician_simultaneous_guidance',
    rule_type: 'addition',
    service_type: 'medical_home_visit',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 610,
    name: '訪問薬剤管理医師同時指導料',
    code: 'MED_PHYSICIAN_SIMULTANEOUS',
    amount: 150,
    conditions: {
      requires_physician_simultaneous: true,
      building_tier: 'single',
      frequency_limit: 'biannual_once',
    },
    evidence_requirements: {
      requires_physician_instruction: true,
      requires_visit_documentation: true,
    },
    source_url: MEDICAL_TABLE_URL,
    source_note:
      '令和8年度診療報酬改定（2026年6月施行・新設） 訪問薬剤管理医師同時指導料 150点（6月に1回、単一建物1人）',
  },

  // ── 第5節 その他（処方箋受付単位） ──
  // 現行の自動候補生成は在宅訪問・薬学管理を中心に扱うため selection_mode は manual。
  // 薬局設定で届出有無を保持し、レセプト/処方箋受付単位の請求実装が参照できるSSOTとして登録する。
  {
    ssot_key: 'medical.dispensing_base_up_evaluation',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 900,
    name: '調剤ベースアップ評価料',
    code: 'MED_DISPENSING_BASE_UP_EVALUATION',
    amount: 4,
    conditions: {
      per_prescription_acceptance: true,
      pharmacy_acceptance_fee: true,
      facility_standard_required: 'dispensing_base_up_evaluation',
      scheduled_point_increase: {
        effective_from: '2027-06-01',
        amount: 8,
      },
    },
    source_url: MEDICAL_TABLE_URL,
    source_note:
      '令和8年度診療報酬改定（2026年6月施行） 調剤ベースアップ評価料 4点（2027年6月以降8点）',
  },
  {
    ssot_key: 'medical.dispensing_price_response',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 910,
    name: '調剤物価対応料',
    code: 'MED_DISPENSING_PRICE_RESPONSE',
    amount: 1,
    conditions: {
      per_prescription_acceptance: true,
      pharmacy_acceptance_fee: true,
      frequency_limit: 'quarterly_once',
      scheduled_point_increase: {
        effective_from: '2027-06-01',
        amount: 2,
      },
    },
    source_url: MEDICAL_TABLE_URL,
    source_note:
      '令和8年度診療報酬改定（2026年6月施行） 調剤物価対応料 1点（3月に1回、2027年6月以降2点）',
  },
  {
    ssot_key: 'medical.electronic_dispensing_info_collaboration',
    rule_type: 'addition',
    service_type: 'generic',
    payer_basis: 'medical',
    provider_scope: 'pharmacy',
    selection_mode: 'manual',
    calculation_unit: 'point',
    display_order: 920,
    name: '電子的調剤情報連携体制整備加算',
    code: 'MED_ELECTRONIC_DISPENSING_INFO_COLLABORATION',
    amount: 8,
    conditions: {
      per_prescription_acceptance: true,
      pharmacy_acceptance_fee: true,
      frequency_limit: 'monthly_once',
      facility_standard_required: 'electronic_dispensing_info_collaboration',
    },
    source_url: MEDICAL_TABLE_URL,
    source_note:
      '令和8年度診療報酬改定（2026年6月施行） 電子的調剤情報連携体制整備加算 8点（月1回）',
  },
];
