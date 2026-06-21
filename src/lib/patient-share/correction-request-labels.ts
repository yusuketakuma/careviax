import {
  patientShareCorrectionFieldPaths,
  type PatientShareCorrectionTargetType,
} from './correction-request-domain';

const CORRECTION_FIELD_LABELS_BY_TARGET_TYPE: Record<
  PatientShareCorrectionTargetType,
  Record<string, string>
> = {
  patient_profile: {
    name: '氏名',
    name_kana: '氏名カナ',
    birth_date: '生年月日',
    gender: '性別',
    phone: '電話',
    allergy_info: 'アレルギー',
    notes: '備考',
    'primary_residence.address': '住所',
    'primary_residence.unit_name': '居室',
  },
  care_case: {
    referral_source: '紹介元',
    referral_date: '紹介日',
    start_date: '開始日',
    end_date: '終了日',
    primary_pharmacist_id: '主担当',
    required_visit_support: '訪問支援',
    notes: '備考',
  },
  management_plan: {
    content: '計画内容',
    goals: '目標',
    monitoring_items: '確認項目',
    review_schedule: '見直し予定',
  },
  visit_request: {
    request_reason: '依頼理由',
    desired_start_at: '希望開始',
    desired_end_at: '希望終了',
    physician_instruction: '医師指示',
    carry_items: '持参物',
    patient_home_notes: '居宅メモ',
  },
  partner_visit_record: {
    visit_at: '訪問日時',
    pharmacist_id: '薬剤師ID',
    pharmacist_name: '薬剤師名',
    record_content: '記録内容',
    attachments: '添付',
  },
  claim_note: {
    prescription_received_by: '処方箋受付',
    dispensing_pharmacy_name: '調剤薬局',
    claim_status: '請求状態',
    claim_note_text: '請求メモ',
  },
  billing_candidate: {
    billing_status: '算定状態',
    exclusion_reason: '除外理由',
    amount_snapshot: '金額',
  },
};

function buildFieldOptions(targetType: PatientShareCorrectionTargetType) {
  const labels = CORRECTION_FIELD_LABELS_BY_TARGET_TYPE[targetType];
  return patientShareCorrectionFieldPaths(targetType).map((value) => ({
    value,
    label: labels[value] ?? value,
  }));
}

export const PATIENT_SHARE_CORRECTION_FIELD_OPTIONS = {
  patient_profile: buildFieldOptions('patient_profile'),
  care_case: buildFieldOptions('care_case'),
  management_plan: buildFieldOptions('management_plan'),
  visit_request: buildFieldOptions('visit_request'),
  partner_visit_record: buildFieldOptions('partner_visit_record'),
  claim_note: buildFieldOptions('claim_note'),
  billing_candidate: buildFieldOptions('billing_candidate'),
} as const satisfies Record<
  PatientShareCorrectionTargetType,
  readonly { value: string; label: string }[]
>;

export const PATIENT_SHARE_CORRECTION_TARGET_LABELS = {
  patient_profile: '患者基本',
  care_case: 'ケース',
  management_plan: '管理計画',
  visit_request: '訪問依頼',
  partner_visit_record: '協力訪問記録',
  claim_note: '請求メモ',
  billing_candidate: '算定候補',
} as const satisfies Record<PatientShareCorrectionTargetType, string>;
