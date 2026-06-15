import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { readJsonObject } from '@/lib/db/json';
import type { VisitBriefBaselineContext } from '@/types/visit-brief';

export const requesterProfessionLabels: Record<string, string> = {
  physician: '医師',
  nursing: '看護',
  care: '介護',
};

export const housingTypeLabels: Record<string, string> = {
  apartment: 'マンション',
  detached: '戸建て',
  facility: '施設',
};

export const careLevelLabels: Record<string, string> = {
  not_applied: '未申請',
  applying: '申請中',
  not_eligible: '非該当',
  support_1: '要支援 1',
  support_2: '要支援 2',
  care_1: '要介護 1',
  care_2: '要介護 2',
  care_3: '要介護 3',
  care_4: '要介護 4',
  care_5: '要介護 5',
};

export const adlLabels: Record<string, string> = {
  independent: '自立',
  a: 'A',
  b: 'B',
  c: 'C',
  unknown: '不明',
};

export const dementiaLabels: Record<string, string> = {
  independent: '自立',
  i: 'I',
  ii: 'II',
  iii: 'III',
  iv: 'IV',
  m: 'M',
  unknown: '不明',
};

export const firstVisitSlotLabels: Record<string, string> = {
  morning: '午前',
  afternoon: '午後',
  specific: '指定',
};

export const moneyManagementLabels: Record<string, string> = {
  self: '本人可',
  family: '家族可',
  unable: '不可',
  public: '公費',
};

export const contactMethodLabels: Record<string, string> = {
  phone: '電話',
  fax: 'FAX',
  mcs: 'MCS',
  email: 'メール',
  other: 'その他',
};

export const medicationSupportLabels: Record<string, string> = {
  unit_dose: '一包化',
  calendar: 'カレンダー',
  box: 'BOX',
  crush: '粉砕',
  simple_suspension: '簡易懸濁',
  tube: '経管',
  other: 'その他',
};

export const specialProcedureLabels: Record<string, string> = {
  aseptic_preparation: '無菌調剤／混注指示',
  tpn: 'TPN',
  cv_port: 'CVポート',
  infusion: '点滴',
  narcotics: '麻薬使用',
  terminal_pain: '末期疼痛管理',
  pressure_ulcer: '褥瘡処置',
  stoma: 'ストーマ処置',
  home_oxygen: '在宅酸素',
  ventilator: '人工呼吸器',
  tracheostomy_suction: '気管切開・吸引',
  enteral_nutrition: '経管栄養',
  enteral_route: '経管投与ルート',
  catheter: 'カテーテル',
  foley_arrangement: 'フーリー手配',
  dialysis: '透析',
};

export const homePharmacyAddOn2CandidateLabels: Record<string, string> = {
  unknown: '未判定',
  not_applicable: '対象外',
  add_on_2_ro_candidate: 'ロ候補',
  add_on_2_i_single_building_candidate: 'イ候補（単一建物1人）',
  add_on_2_i_severe_patient_candidate: 'イ候補（重症患者等）',
};

export const singleBuildingCountLabels: Record<string, string> = {
  one: '1人',
  two_to_nine: '2〜9人',
  ten_or_more: '10人以上',
  unknown: '不明',
};

export const homeCareBillingCategoryLabels: Record<string, string> = {
  medical_home_visit: '在宅患者訪問薬剤管理指導料',
  emergency_home_visit: '在宅患者緊急訪問薬剤管理指導料',
  emergency_joint_guidance: '在宅患者緊急時等共同指導料',
  care_home_management: '居宅療養管理指導費',
  preventive_care_home_management: '介護予防居宅療養管理指導費',
  unknown: '不明',
};

export const medicalHomeManagementTypeLabels: Record<string, string> = {
  home_medical_management: '在医総管',
  facility_medical_management: '施設総管',
  unknown: '不明',
};

export const medicalHomeManagementSectionLabels: Record<string, string> = {
  one_i_1: '1のイ(1)',
  one_ro_1: '1のロ(1)',
  two_i: '2のイ',
  three_i: '3のイ',
  other: 'その他',
  unknown: '不明',
};

export const confirmationStatusLabels: Record<string, string> = {
  yes: '該当',
  no: '非該当',
  unknown: '未確認',
};

export const narcoticUseCategoryLabels: Record<string, string> = {
  none: 'なし',
  base: 'ベース',
  rescue: 'レスキュー',
  injection: '注射薬',
  continuous_pca: '持続投与・PCA',
};

export const asepticPreparationNeedLabels: Record<string, string> = {
  unnecessary: '不要',
  necessary: '必要',
  unknown: '未確認',
};

export const visitingNurseFrequencyLabels: Record<string, string> = {
  none: 'なし',
  less_than_monthly: '月1回未満',
  monthly: '月1回以上',
  weekly: '週1回以上',
  multiple_weekly: '週複数回',
  unknown: '不明',
};

export const homeCareStatusLabels: Record<string, string> = {
  preparing: '新規準備中',
  active: '稼働中',
  hospitalized: '入院中',
  paused: '休止',
  ended: '終了',
  deceased: '死亡',
  unknown: '不明',
};

export const emergencyResponseLabels: Record<string, string> = {
  normal: '通常対応',
  twenty_four_hour: '24時間対応',
  partner_pharmacy: '協力薬局対応',
  unavailable: '対応不可',
  unknown: '不明',
};

export const visitFrequencyLabels: Record<string, string> = {
  weekly: '週1回',
  biweekly: '隔週',
  monthly: '月1回',
  ad_hoc: '臨時のみ',
  unknown: '不明',
};

export const medicationManagerLabels: Record<string, string> = {
  self: '本人',
  family: '家族',
  visiting_nurse: '訪問看護',
  facility: '施設',
  pharmacist: '薬剤師',
  unknown: '不明',
};

export const supportStatusLabels: Record<string, string> = {
  none: 'なし',
  pending: '未対応',
  proposed: '提案済',
  reflected: '反映',
  rejected: '却下',
  unknown: '不明',
};

export const triageRiskLabels: Record<string, string> = {
  none: 'なし',
  low: '低',
  medium: '中',
  high: '高',
  unknown: '不明',
};

export type HomeVisitIntake = {
  requester?: {
    organization_name?: string;
    profession?: string;
    contact_name?: string;
    contact_name_kana?: string;
    phone?: string;
    fax?: string;
    pharmacy_decision_due_date?: string;
    preferred_contact_method?: string;
    preferred_contact_method_other?: string;
  };
  reported_age?: number;
  primary_disease?: string;
  postal_code?: string;
  housing_type?: string;
  facility_name?: string;
  mcs_linked?: boolean;
  primary_contact_preference?: string;
  contact_phone?: string;
  contact_mobile?: string;
  emergency_contact?: {
    name?: string;
    relation?: string;
    phone?: string;
  };
  visit_before_contact_required?: boolean;
  first_visit_date?: string;
  first_visit_time_slot?: string;
  first_visit_time_note?: string;
  money_management?: string;
  parking_available?: boolean;
  family_key_person?: string;
  care_level?: string;
  adl_level?: string;
  dementia_level?: string;
  medication_support_methods?: string[];
  medication_support_other?: string;
  ent_prescription?: boolean;
  ent_period_from?: string;
  ent_period_to?: string;
  initial_transition_management_expected?: boolean;
  narcotics_base?: boolean;
  narcotics_rescue?: boolean;
  allergy_history?: string;
  infection_isolation?: string;
  swallowing_route?: string;
  residual_medication_status?: string;
  other_clinical_notes?: string;
  special_medical_procedures?: string[];
  special_medical_notes?: string;
  home_care_status?: string;
  home_start_date?: string;
  home_end_date?: string;
  home_end_reason?: string;
  emergency_response?: string;
  after_hours_explanation_date?: string;
  patient_tags?: string[];
  visit_frequency?: string;
  regular_visit_slot?: string;
  visit_available_time_note?: string;
  access_key_info?: string;
  medication_handover_place?: string;
  medication_storage_location?: string;
  collection_method?: string;
  payer?: string;
  medication_manager?: string;
  medication_ability?: string;
  missed_dose_pattern?: string;
  residual_medication_pattern?: string;
  residual_medication_checked_on?: string;
  residual_adjustment_status?: string;
  crushing_check_status?: string;
  simple_suspension_check_status?: string;
  egfr_value?: string;
  egfr_measured_on?: string;
  weight_kg?: string;
  weight_measured_on?: string;
  high_risk_drug_flags?: string[];
  adverse_monitoring_items?: string[];
  pain_score?: string;
  rescue_use_count_recent?: string;
  constipation_status?: string;
  drowsiness_delirium_status?: string;
  fall_risk?: string;
  pressure_ulcer_status?: string;
  medical_material_supplier?: string;
  material_exchange_due_note?: string;
  device_vendor_contact?: string;
  document_status_note?: string;
  report_destination_note?: string;
  emergency_policy_note?: string;
  interprofessional_action_note?: string;
  home_pharmacy_add_on_2?: {
    candidate?: string;
    single_building_medical_patient_count?: string;
    single_building_resident_count?: string;
    home_care_billing_category?: string;
    medical_home_management_type?: string;
    medical_home_management_section?: string;
    comprehensive_support_add_on?: string;
    table_8_2_applicable?: string;
    table_8_3_applicable?: string;
    narcotic_use_categories?: string[];
    aseptic_preparation_need?: string;
    pediatric_home_care?: string;
    infant_add_on_candidate?: string;
    medical_care_child?: string;
    visiting_nurse_frequency?: string;
    weekly_visiting_nurse?: string;
    nursing_or_family_procedure?: string;
    medical_material_supply?: string;
    advanced_medical_device?: string;
  };
  intake_note?: string;
  care_manager?: {
    name?: string;
    name_kana?: string;
    organization_name?: string;
    phone?: string;
    fax?: string;
  };
  visiting_nurse?: {
    name?: string;
    name_kana?: string;
    organization_name?: string;
    phone?: string;
    fax?: string;
  };
};

export function buildBaselineContext(
  intake: HomeVisitIntake | null,
  visitBeforeContactRequired?: boolean | null,
): VisitBriefBaselineContext | null {
  const vbcr = visitBeforeContactRequired ?? null;
  if (!intake && vbcr === null) return null;
  return {
    care_level: intake?.care_level ?? null,
    adl_level: intake?.adl_level ?? null,
    dementia_level: intake?.dementia_level ?? null,
    medication_support_methods: intake?.medication_support_methods ?? [],
    special_medical_procedures: intake?.special_medical_procedures ?? [],
    family_key_person: intake?.family_key_person ?? null,
    money_management: intake?.money_management ?? null,
    visit_before_contact_required: vbcr,
    narcotics_base: intake?.narcotics_base ?? null,
    narcotics_rescue: intake?.narcotics_rescue ?? null,
    infection_isolation: intake?.infection_isolation ?? null,
  };
}

export function getHomeVisitIntake(value: unknown): HomeVisitIntake | null {
  const root = readJsonObject(value);
  const intake = readJsonObject(root?.home_visit_intake);
  return intake as HomeVisitIntake | null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function getHomeVisitSpecialMedicalProcedures(value: unknown): string[] {
  return readStringArray(getHomeVisitIntake(value)?.special_medical_procedures);
}

export function getHomeVisitMedicationSupportMethods(value: unknown): string[] {
  return readStringArray(getHomeVisitIntake(value)?.medication_support_methods);
}

export function formatOptionalDate(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'yyyy/MM/dd', { locale: ja });
  } catch {
    return value;
  }
}

export function formatBoolean(value: boolean | undefined, trueLabel = 'あり', falseLabel = 'なし') {
  if (value === undefined) return '—';
  return value ? trueLabel : falseLabel;
}

export function labelOf(value: string | null | undefined, labels: Record<string, string>) {
  if (!value) return '—';
  return labels[value] ?? value;
}

export function joinLabeledValues(values: string[] | undefined, labels: Record<string, string>) {
  if (!values || values.length === 0) return [];
  return values.map((value) => labels[value] ?? value);
}
