// ─── Structured SOAP Types ──────────────────────────────────────────────────
// 厚労省「多職種連携推進のための在宅患者訪問薬剤管理指導ガイド」準拠
// 薬学的評価シート7項目: ①検査値 ②睡眠 ③認知 ④食事口腔 ⑤歩行運動 ⑥排泄 ⑦有害事象

export type VitalSigns = {
  systolic_bp?: number;
  diastolic_bp?: number;
  pulse?: number;
  temperature?: number;
  spo2?: number;
  weight?: number;
};

export type LabValues = {
  // Hematology
  wbc?: number;
  neut?: number;
  hb?: number;
  plt?: number;
  // Coagulation
  pt_inr?: number;
  // Liver
  ast?: number;
  alt?: number;
  t_bil?: number;
  // Renal
  scr?: number;
  egfr?: number;
  bun?: number;
  // Cardiac
  ck?: number;
  bnp?: number;
  nt_pro_bnp?: number;
  // Electrolytes
  na?: number;
  k?: number;
  cl?: number;
  // Metabolic
  hba1c?: number;
  blood_glucose?: number;
  alb?: number;
  tp?: number;
  // Inflammation
  crp?: number;
  // Free text for additional values
  free_text?: string;
};

export type FunctionalAssessment = {
  sleep: string[];
  cognition: string[];
  diet_oral: string[];
  mobility: string[];
  excretion: string[];
};

export type AdverseEvents = {
  has_events: boolean;
  events: string[];
  details?: string;
};

export type ResidualMedicationEntry = {
  drug_name: string;
  remaining_quantity: number;
  excess_days: number;
  is_reduction_target: boolean;
};

export type HandoffData = {
  next_check_items: string[];
  ongoing_monitoring: string[];
  decision_rationale: string | null;
  ai_extracted: boolean;
  ai_confidence: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  extracted_at: string | null;
};

export type SoapSubjective = {
  symptom_checks: string[];
  free_text?: string;
};

export type SoapObjective = {
  vitals?: VitalSigns;
  lab_values?: LabValues;
  medication_status: string;
  adherence_score: 1 | 2 | 3 | 4 | 5;
  self_management_ability?: string;
  medication_calendar_used?: boolean;
  side_effect_checks: string[];
  functional_assessment?: FunctionalAssessment;
  adverse_events?: AdverseEvents;
  free_text?: string;
};

export type SoapAssessment = {
  problem_checks: string[];
  severity?: string;
  drug_related_problems?: string[];
  free_text?: string;
};

export type SoapPlan = {
  intervention_checks: string[];
  next_visit_date?: string;
  prescription_proposal?: string;
  physician_report_items?: string;
  care_manager_report_items?: string;
  care_service_coordination?: string;
  free_text?: string;
};

export type StructuredSoap = {
  subjective: SoapSubjective;
  objective: SoapObjective;
  assessment: SoapAssessment;
  plan: SoapPlan;
  residual_medications?: ResidualMedicationEntry[];
  handoff?: HandoffData | null;
};
