import type { PayerBasis } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────
// 算定条件（conditions）の構造化型
// システムが自動判定に使用する。各ルールの conditions フィールドに格納。
// ─────────────────────────────────────────────────────────────────

export type BillingRuleConditions = {
  // ── 単一建物居住者区分 ──
  /** single | multi_2_9 | multi_10_plus */
  building_tier?: 'single' | 'multi_2_9' | 'multi_10_plus';

  // ── 算定頻度上限 ──
  /** 月あたりの算定上限回数 (通常4回) */
  monthly_cap?: number;
  /** 特別患者(末期悪性腫瘍/麻薬注射/中心静脈栄養)の月上限 (通常8回) */
  special_monthly_cap?: number;
  /** 特別患者の週上限 (通常2回) */
  special_weekly_cap?: number;
  /** 薬剤師1人あたりの週上限 (通常40回) */
  weekly_pharmacist_cap?: number;
  /** 算定頻度制限 */
  frequency_limit?: 'monthly_once' | 'quarterly_once' | 'biannual_once';
  /** 処方箋受付ごとに算定する項目 */
  per_prescription_acceptance?: boolean;
  /** 同一患者・処方箋受付等に依存しない薬局単位の受付料 */
  pharmacy_acceptance_fee?: boolean;
  /** 同一改定内の予定点数変更 */
  scheduled_point_increase?: {
    effective_from: string;
    amount: number;
  };
  /** 入院1回につき1回のみ */
  once_per_admission?: boolean;
  /** 患者につき初回のみ (在宅移行初期管理料等) */
  once_per_patient?: boolean;
  /** 月上限を他の区分と共有 (オンラインは通常訪問と合算) */
  monthly_cap_shared?: boolean;

  // ── 訪問種別 ──
  /** 緊急訪問フラグ (visit_type=emergency 判定) */
  visit_type?: 'emergency';
  /** 緊急訪問の区分: 計画的訪問対象疾患急変(500点) / その他(200点) / オンライン(59点) */
  emergency_category?: 'planned_disease_exacerbation' | 'other_exacerbation' | 'online';
  /** オンライン指導フラグ */
  requires_online_visit?: boolean;
  /** 緊急訪問の時間帯加算 */
  after_hours_visit?: 'night' | 'holiday' | 'midnight';

  // ── 患者要件 ──
  /** 介護認定区分: care_required(要介護) / support_required(要支援) */
  care_level_category?: 'care_required' | 'support_required';
  /** 麻薬処方の管理が必要 */
  requires_narcotic_management?: boolean;
  /** 麻薬処方があること（介護保険 麻薬管理指導加算用） */
  requires_narcotic_prescription?: boolean;
  /** 医療用麻薬持続注射療法の実施 */
  requires_narcotic_continuous_injection?: boolean;
  /** 在宅中心静脈栄養法の実施 */
  requires_central_venous_nutrition?: boolean;
  /** 乳幼児（6歳未満）であること */
  requires_infant_eligibility?: boolean;
  /** 小児特定加算対象 (児童福祉法に定める障害児, 18歳未満) */
  requires_pediatric_special_eligibility?: boolean;
  /** 経管投薬が必要 */
  requires_enteral_feeding?: boolean;
  /** 在宅移行初期の対象患者 (認知症/精神/18歳未満障害児/6歳未満/末期悪性腫瘍/麻薬注射) */
  requires_initial_transition?: boolean;
  /** 特別上限(月8回)の対象 (末期悪性腫瘍/麻薬注射/中心静脈栄養) */
  special_cap_eligible?: boolean;

  // ── 施設基準・許可 ──
  /** 必要な施設基準届出 (e.g., home_comprehensive_1, home_comprehensive_2) */
  facility_standard_required?: string;

  // ── 連携要件 ──
  /** 医師の指示が必要 */
  requires_physician_instruction?: boolean;
  /** 退院時カンファレンス参加が必要 */
  requires_hospital_conference?: boolean;
  /** 緊急時カンファレンス参加が必要 */
  requires_emergency_conference?: boolean;
  /** ケアマネジャーへの報告が必要（介護保険） */
  requires_care_manager_report?: boolean;

  // ── 服薬情報等提供料 区分 ──
  /** 提供料の種別 (1 / 2_i / 2_ro / 2_ha / 3) */
  information_provision_type?: '1' | '2_i' | '2_ro' | '2_ha' | '3';
  /** 提供先 */
  target?: 'medical_institution' | 'prescriber' | 'care_manager';
  /** 医療機関からの依頼による */
  requested_by_medical_institution?: boolean;
  /** リフィル処方フォローアップ */
  refill_followup?: boolean;
  /** 入院前の持参薬確認 */
  pre_admission_medication_reconciliation?: boolean;
  /** 居宅療養管理指導と同一月で算定不可 */
  same_month_home_management_disallowed?: boolean;

  // ── 重複投薬・相互作用等防止管理料 区分 ──
  /** 種別 (1_i / 1_ro / 2_i / 2_ro) */
  duplicate_interaction_type?: '1_i' | '1_ro' | '2_i' | '2_ro';
  /** 残薬調整による (20点に減額) */
  residual_adjustment?: boolean;
  /** 処方変更の実施 */
  requires_prescription_change?: boolean;
  /** 処方提案が処方に反映された */
  proposal_reflected?: boolean;

  // ── 併算定制限 ──
  /** 同一月に算定不可の他コード (code値の配列) */
  exclusive_with?: string[];

  // ── 地域加算 ──
  /** 地域加算種別 */
  region_add_on?: 'special_15' | 'small_office_10' | 'resident_5';

  // ── 2026年新設項目の要件 ──
  /** 複数名訪問が必要（暴力行為等のある患者、医師が必要と認めた場合） */
  requires_multi_staff_visit?: boolean;
  /** 医師との同時訪問（ポリファーマシー・残薬対策） */
  requires_physician_simultaneous?: boolean;
  /** 薬学的有害事象等防止の対象（処方提案反映/疑義照会） */
  adverse_event_prevention_type?: 'proposal_reflected' | 'consultation_change';
  /** 残薬調整の対象（7日分以上の投薬変更） */
  requires_residual_adjustment_home?: boolean;
};

// ─────────────────────────────────────────────────────────────────
// エビデンス要件の構造化型
// 算定に必要な文書・記録・許可の一覧。
// ─────────────────────────────────────────────────────────────────

export type BillingEvidenceRequirements = {
  /** 医師の訪問指示（処方箋または診療情報提供書に記載） */
  requires_physician_instruction?: boolean;
  /** 薬学的管理指導計画書（承認済み ManagementPlan） */
  requires_management_plan?: boolean;
  /** 訪問記録（VisitRecord に SOAP 等記載） */
  requires_visit_documentation?: boolean;
  /** 医師への文書報告（CareReport 送達完了） */
  requires_written_report?: boolean;
  /** ケアマネジャーへの報告 */
  requires_care_manager_report?: boolean;
  /** 服薬管理記録 */
  requires_medication_management_record?: boolean;
  /** 麻薬管理指導の記録 */
  narcotic_management_record?: boolean;
  /** 麻薬持続注射の管理記録 */
  narcotic_injection_management_record?: boolean;
  /** 中心静脈栄養法の管理記録 */
  central_venous_management_record?: boolean;
  /** 麻薬小売業者の免許 */
  narcotic_dealer_license?: boolean;
  /** 高度管理医療機器販売業許可 */
  high_care_medical_device_license?: boolean;
};

// ─────────────────────────────────────────────────────────────────
// 併算定制限の構造化型
// ─────────────────────────────────────────────────────────────────

export type BillingExclusionRules = {
  /** 同一月に算定不可の薬学管理料 */
  same_month_exclusive?: string[];
  /** 同一処方箋受付で算定不可 */
  same_prescription_exclusive?: string[];
  /** 同一訪問で算定不可 */
  same_visit_exclusive?: string[];
};

// ─────────────────────────────────────────────────────────────────
// ルール定義
// ─────────────────────────────────────────────────────────────────

export type BillingRuleSeed = {
  ssot_key: string;
  rule_type: 'base' | 'addition' | 'regional_addition' | 'reduction';
  service_type: 'medical_home_visit' | 'care_home_management' | 'generic';
  payer_basis: PayerBasis;
  provider_scope: 'pharmacy' | 'hospital_clinic' | null;
  selection_mode: 'auto' | 'manual';
  calculation_unit: 'point' | 'unit' | 'percent';
  display_order: number;
  name: string;
  code: string;
  amount: number;
  conditions: BillingRuleConditions;
  evidence_requirements?: BillingEvidenceRequirements;
  exclusion_rules?: BillingExclusionRules;
  source_url: string;
  source_note: string;
};

// ─────────────────────────────────────────────────────────────────
// コンテキスト（算定判定時に渡す情報）
// ─────────────────────────────────────────────────────────────────

export type BillingEvidenceContext = {
  orgId: string;
  asOfDate?: Date;
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
  /** Emergency category from the latest prescription intake */
  emergencyCategory?: 'planned_disease_exacerbation' | 'other_exacerbation' | 'online' | null;
  /** After-hours category derived from visit timing or holiday settings */
  afterHoursVisit?: 'night' | 'holiday' | 'midnight' | null;

  // ── 患者データから自動判定された条件 ──
  /** 乳幼児（6歳未満） — Patient.birth_date から自動計算 */
  infantEligible?: boolean;
  /** 18歳未満 — Patient.birth_date から自動計算（小児特定加算の年齢要件） */
  pediatricAge?: boolean;
  /** 麻薬処方あり — intake.narcotics_base/rescue から自動判定 */
  narcoticRequired?: boolean;
  /** 麻薬持続注射 — intake.special_medical_procedures から自動判定 */
  narcoticInjectionRequired?: boolean;
  /** 中心静脈栄養法 — intake.special_medical_procedures から自動判定 */
  centralVenousRequired?: boolean;
  /** 経管投薬 — intake.medication_support_methods から自動判定 */
  enteralRequired?: boolean;
  /** 介護認定区分 — intake.care_level から自動判定 */
  careLevelCategory?: 'care_required' | 'support_required' | null;
  /** 在宅移行初期管理料の対象 */
  initialTransitionEligible?: boolean;
  /** 複数名薬剤管理指導訪問料の対象 */
  multiStaffVisitEligible?: boolean;
  /** 訪問薬剤管理医師同時指導料の対象 */
  physicianSimultaneousEligible?: boolean;
  /** Pharmacy-site facility standards resolved from the active site config */
  facilityStandards?: Record<string, boolean>;
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

export type BillingRevision = {
  code: string; // e.g., '2024'
  label: string; // e.g., '令和6年度(2024)改定'
  effectiveFrom: Date; // e.g., 2024-06-01
  effectiveTo: Date | null; // null = current
  source: string; // URL to official gazette
  status?: 'draft' | 'confirmed';
};
