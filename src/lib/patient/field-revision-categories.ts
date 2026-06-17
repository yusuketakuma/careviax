export const PATIENT_FIELD_REVISION_CATEGORIES = [
  'basic',
  'residence',
  'contacts',
  'conditions',
  'clinical',
  'insurance',
  'medical_care',
  'narcotic',
] as const;

export type PatientFieldRevisionCategory = (typeof PATIENT_FIELD_REVISION_CATEGORIES)[number];

export const PATIENT_FIELD_REVISION_CATEGORY_LABELS: Record<PatientFieldRevisionCategory, string> =
  {
    basic: '基本情報',
    residence: '住所',
    contacts: '連絡先',
    conditions: '病名',
    clinical: '臨床',
    insurance: '保険',
    medical_care: '医療処置',
    narcotic: '麻薬',
  };
