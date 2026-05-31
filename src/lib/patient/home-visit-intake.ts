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
