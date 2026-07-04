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
  drug_master_id?: string | null;
  drug_code?: string | null;
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

export type PhysicianSimultaneousVisitEvidence = {
  performed?: boolean;
  patient_consent?: boolean;
  physician_name?: string;
  physician_institution?: string;
  medication_adjustment_discussed?: boolean;
  discussion_summary?: string;
  same_day_exclusion_checked?: boolean;
};

export type MultiStaffVisitEvidence = {
  performed?: boolean;
  patient_consent?: boolean;
  physician_need_confirmed?: boolean;
  safety_reason?: 'agitation' | 'aggression' | 'severe_anxiety' | 'self_harm_risk' | 'other';
  companion_name?: string;
  companion_role?: string;
  necessity_summary?: string;
};

export type InitialTransitionManagementEvidence = {
  target?: boolean;
  pre_visit_environment_assessed?: boolean;
  medication_risk_assessed?: boolean;
  transition_support_summary?: string;
};

export type HomeVisit2026Evidence = {
  medication_review_completed?: boolean;
  residual_medication_checked?: boolean;
  adverse_event_checked?: boolean;
  polypharmacy_reviewed?: boolean;
  after_hours_contact_confirmed?: boolean;
  physician_simultaneous?: PhysicianSimultaneousVisitEvidence;
  multi_staff_visit?: MultiStaffVisitEvidence;
  initial_transition_management?: InitialTransitionManagementEvidence;
};

export type SpecialPatientStatusType =
  | 'terminal_cancer'
  | 'injectable_narcotic'
  | 'home_central_venous_nutrition'
  | 'heart_failure'
  | 'respiratory_failure'
  | 'other';

export type SpecialPatientStatusCapture = {
  status_type: SpecialPatientStatusType;
  evidence_summary: string;
  set_by?: string;
  set_at: string;
  valid_from: string;
  valid_to?: string | null;
};

export type PreviousVisitReuseSource = {
  source_visit_record_id: string;
  source_visit_record_version: number | null;
  source_visit_record_updated_at: string | null;
  carry_forward_items: string[];
};

export type StructuredSoap = {
  subjective: SoapSubjective;
  objective: SoapObjective;
  assessment: SoapAssessment;
  plan: SoapPlan;
  residual_medications?: ResidualMedicationEntry[];
  home_visit_2026?: HomeVisit2026Evidence;
  special_patient_statuses?: SpecialPatientStatusCapture[];
  handoff?: HandoffData | null;
  previous_visit_reuse?: PreviousVisitReuseSource;
};
