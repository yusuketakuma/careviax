// ─── SOAP 構造化入力の選択肢定数 ─────────────────────────────────────────────
// 厚労省「在宅患者訪問薬剤管理指導ガイド」薬学的評価シート7項目に準拠

// ─── S: 主観（症状チェック） ─────────────────────────────────────────────────

export const SYMPTOM_OPTIONS = [
  { value: 'no_symptoms', label: '自覚症状なし' },
  { value: 'pain', label: '痛み' },
  { value: 'itching', label: 'かゆみ' },
  { value: 'dizziness', label: 'めまい' },
  { value: 'appetite_loss', label: '食欲不振' },
  { value: 'constipation', label: '便秘' },
  { value: 'diarrhea', label: '下痢' },
  { value: 'insomnia', label: '不眠' },
  { value: 'fatigue', label: '倦怠感' },
  { value: 'edema', label: 'むくみ' },
  { value: 'dry_mouth', label: '口渇' },
  { value: 'palpitation', label: '動悸' },
  { value: 'dyspnea', label: '息切れ' },
  { value: 'nausea', label: '吐気' },
] as const;

// ─── O: 客観（服薬状況） ─────────────────────────────────────────────────────

export const MEDICATION_STATUS_OPTIONS = [
  { value: 'full_compliance', label: '全量服用', color: 'bg-green-100 text-green-800' },
  { value: 'partial_remaining', label: '一部残薬あり', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'missed_doses', label: '飲み忘れあり', color: 'bg-orange-100 text-orange-800' },
  { value: 'refusal', label: '拒薬', color: 'bg-red-100 text-red-800' },
] as const;

export const ADHERENCE_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: '全く服用せず', color: 'bg-red-500 text-white' },
  2: { label: '不良', color: 'bg-red-300 text-red-900' },
  3: { label: 'やや不良', color: 'bg-orange-200 text-orange-900' },
  4: { label: '概ね良好', color: 'bg-yellow-100 text-yellow-800' },
  5: { label: '良好', color: 'bg-green-100 text-green-800' },
};

export const SELF_MANAGEMENT_OPTIONS = [
  { value: 'independent', label: '自立' },
  { value: 'with_support', label: '支援あり' },
  { value: 'dependent', label: '要介助' },
] as const;

// ─── O: 薬学的評価シート ② 睡眠 ────────────────────────────────────────────

export const SLEEP_OPTIONS = [
  { value: 'no_issues', label: '問題なし' },
  { value: 'difficulty_falling_asleep', label: '入眠困難' },
  { value: 'nocturnal_awakening', label: '中途覚醒' },
  { value: 'early_awakening', label: '早朝覚醒' },
  { value: 'daytime_drowsiness', label: '日中傾眠' },
] as const;

// ─── O: 薬学的評価シート ③ 認知・感覚機能 ──────────────────────────────────

export const COGNITION_OPTIONS = [
  { value: 'no_issues', label: '問題なし' },
  { value: 'memory_decline', label: '記憶力低下' },
  { value: 'disorientation', label: '見当識障害' },
  { value: 'delirium', label: 'せん妄' },
  { value: 'sensory_decline', label: '視力・聴力低下' },
] as const;

// ─── O: 薬学的評価シート ④ 食事・口腔機能 ──────────────────────────────────

export const DIET_ORAL_OPTIONS = [
  { value: 'no_issues', label: '問題なし' },
  { value: 'appetite_loss', label: '食欲低下' },
  { value: 'dysphagia', label: '嚥下困難' },
  { value: 'dry_mouth', label: '口腔乾燥' },
  { value: 'taste_disorder', label: '味覚異常' },
] as const;

// ─── O: 薬学的評価シート ⑤ 歩行・運動機能 ──────────────────────────────────

export const MOBILITY_OPTIONS = [
  { value: 'no_issues', label: '問題なし' },
  { value: 'unsteadiness', label: 'ふらつき' },
  { value: 'fall_history', label: '転倒歴あり' },
  { value: 'grip_decline', label: '握力低下' },
  { value: 'orthostatic_hypotension', label: '起立性低血圧' },
] as const;

// ─── O: 薬学的評価シート ⑥ 排泄 ────────────────────────────────────────────

export const EXCRETION_OPTIONS = [
  { value: 'no_issues', label: '問題なし' },
  { value: 'constipation', label: '便秘' },
  { value: 'diarrhea', label: '下痢' },
  { value: 'frequent_urination', label: '頻尿' },
  { value: 'incontinence', label: '尿失禁' },
] as const;

// ─── O: 薬学的評価シート ⑦ 有害事象 ────────────────────────────────────────

export const ADVERSE_EVENT_OPTIONS = [
  { value: 'skin', label: '皮膚症状（発疹・かゆみ）' },
  { value: 'gastrointestinal', label: '消化器症状（嘔気・下痢・便秘）' },
  { value: 'bleeding', label: '出血傾向（あざ・鼻出血）' },
  { value: 'edema', label: '浮腫' },
  { value: 'other', label: 'その他' },
] as const;

// ─── A: 評価（薬学的問題チェック） ──────────────────────────────────────────

export const PROBLEM_CHECK_OPTIONS = [
  { value: 'no_issues', label: '問題なし' },
  { value: 'interaction_risk', label: '相互作用リスク' },
  { value: 'side_effect_suspected', label: '副作用疑い' },
  { value: 'dose_inappropriate', label: '用量不適切' },
  { value: 'adherence_decline', label: 'アドヒアランス低下' },
  { value: 'duplicate_medication', label: '重複投薬' },
  { value: 'drug_related_geriatric', label: '薬剤起因性老年症候群' },
] as const;

export const SEVERITY_OPTIONS = [
  { value: 'mild', label: '軽度', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'moderate', label: '中等度', color: 'bg-orange-100 text-orange-800' },
  { value: 'severe', label: '重度', color: 'bg-red-100 text-red-800' },
] as const;

// ─── P: 計画（介入内容チェック） ────────────────────────────────────────────

export const INTERVENTION_OPTIONS = [
  { value: 'medication_guidance', label: '服薬指導' },
  { value: 'prescription_proposal', label: '処方提案' },
  { value: 'physician_contact', label: '医師連絡' },
  { value: 'care_manager_contact', label: 'ケアマネ連絡' },
  { value: 'residual_adjustment', label: '残薬調整' },
  { value: 'unit_dose_proposal', label: '一包化提案' },
  { value: 'calendar_proposal', label: '服薬カレンダー提案' },
  { value: 'next_followup', label: '次回フォロー' },
] as const;

// ─── ラベル変換ヘルパー ─────────────────────────────────────────────────────

const allOptions = [
  ...SYMPTOM_OPTIONS,
  ...MEDICATION_STATUS_OPTIONS,
  ...SELF_MANAGEMENT_OPTIONS,
  ...SLEEP_OPTIONS,
  ...COGNITION_OPTIONS,
  ...DIET_ORAL_OPTIONS,
  ...MOBILITY_OPTIONS,
  ...EXCRETION_OPTIONS,
  ...ADVERSE_EVENT_OPTIONS,
  ...PROBLEM_CHECK_OPTIONS,
  ...SEVERITY_OPTIONS,
  ...INTERVENTION_OPTIONS,
];

const labelMap = new Map<string, string>(allOptions.map((o) => [o.value, o.label]));

export function getSoapLabel(value: string): string {
  return labelMap.get(value) ?? value;
}
