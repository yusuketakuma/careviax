export type VisitBriefContext = 'patient' | 'schedule';

export type VisitBriefSeverity = 'urgent' | 'high' | 'normal' | 'low';

export type VisitBriefChangeType =
  | 'added'
  | 'removed'
  | 'dose_changed'
  | 'frequency_changed'
  | 'unchanged';

export type VisitBriefMedicationChange = {
  drug_name: string;
  change_type: VisitBriefChangeType;
  previous: string | null;
  current: string;
  prescribed_date: string | null;
  prescriber_name: string | null;
};

export type VisitBriefMedicationItem = {
  drug_name: string;
  dose: string;
  frequency: string;
  dosage_form: string | null;
  route: string | null;
  prescriber_name: string | null;
  start_date: string | null;
  end_date: string | null;
  source: string | null;
  /** DrugMaster enrichment (null if drug_code unresolved) */
  drug_price: number | null;
  is_generic: boolean | null;
  is_narcotic: boolean | null;
  is_psychotropic: boolean | null;
  therapeutic_category: string | null;
};

export type VisitBriefDrugCaution = {
  drug_name: string;
  drug_code: string;
  caution_type: 'contraindication' | 'adverse_effect' | 'elderly_precaution' | 'interaction';
  severity: 'critical' | 'warning' | 'info';
  summary: string;
};

export type VisitBriefDispensingItem = {
  drug_name: string;
  dispensing_method: string | null;
  packaging_instructions: string | null;
  set_method: string | null;
  set_period_label: string | null;
  audit_status: string | null;
  note: string;
};

export type VisitBriefDeliveryItem = {
  title: string;
  status_bucket: 'unconfirmed' | 'reply_waiting' | 'failed' | 'shared';
  summary: string;
  occurred_at: string | null;
  action_href: string;
};

export type VisitBriefDosageFormCandidate = {
  drug_name: string | null;
  category: 'unit_dose' | 'crush' | 'form_change';
  reason: string;
  caution: string | null;
};

export type VisitBriefCommunicationItem = {
  source_type: 'self_report' | 'communication' | 'request' | 'contact_log' | 'care_team';
  title: string;
  summary: string;
  occurred_at: string | null;
  counterpart: string | null;
  severity: VisitBriefSeverity;
};

export type VisitBriefUnresolvedItem = {
  source_type: 'task' | 'issue' | 'inquiry' | 'billing';
  title: string;
  summary: string;
  severity: VisitBriefSeverity;
  href: string;
};

export type VisitBriefAiSummary = {
  generation_id: string;
  provider: 'rule' | 'openai';
  requested_provider: string;
  is_fallback: boolean;
  model: string | null;
  fallback_reason: string | null;
  headline: string;
  bullets: string[];
  must_check_today: string[];
  source_refs: string[];
  generated_at: string;
  duration_ms: number | null;
  recent_generation_count_24h: number;
  recent_failure_count_24h: number;
  recent_failure_rate_24h: number | null;
};

export type VisitBriefRuleSummary = {
  generation_id: string;
  headline: string;
  bullets: string[];
  must_check_today: string[];
  source_refs: string[];
  generated_at: string;
};

export type VisitBriefBaselineContext = {
  care_level: string | null;
  adl_level: string | null;
  dementia_level: string | null;
  medication_support_methods: string[];
  special_medical_procedures: string[];
  family_key_person: string | null;
  money_management: string | null;
  visit_before_contact_required: boolean | null;
  narcotics_base: boolean | null;
  narcotics_rescue: boolean | null;
  infection_isolation: string | null;
};

export type VisitBriefConferenceSummary = {
  recent_conferences: number;
  pending_action_items: number;
  last_conference_date: string | null;
  last_conference_type: string | null;
};

export type VisitBriefFacilityContext = {
  acceptance_time_from: string | null;
  acceptance_time_to: string | null;
  notes: string | null;
};

export type VisitBrief = {
  patient: {
    id: string;
    name: string;
  };
  context: VisitBriefContext;
  generated_at: string;
  last_prescribed_date: string | null;
  baseline_context: VisitBriefBaselineContext | null;
  medication_changes: VisitBriefMedicationChange[];
  medications: VisitBriefMedicationItem[];
  dispensing_items: VisitBriefDispensingItem[];
  delivery_status: VisitBriefDeliveryItem[];
  dosage_form_support: VisitBriefDosageFormCandidate[];
  multidisciplinary_updates: VisitBriefCommunicationItem[];
  unresolved_items: VisitBriefUnresolvedItem[];
  must_check_today: string[];
  rule_summary: VisitBriefRuleSummary;
  ai_summary: VisitBriefAiSummary;
  conference_summary: VisitBriefConferenceSummary | null;
  facility_context: VisitBriefFacilityContext | null;
  drug_cautions: VisitBriefDrugCaution[];
};

// ─── CareTrend ────────────────────────────────────────────────────────────────

export type CareTrendEntry = {
  visit_date: string;
  value: number;
  label: string | null;
};

export type CareTrend = {
  residual_trend: CareTrendEntry[];
  residual_direction: 'increasing' | 'stable' | 'decreasing';
  issue_timeline: {
    issue_id: string;
    title: string;
    current_status: string;
    identified_at: string;
    resolved_at: string | null;
  }[];
};

// ─── VisitHandoff ─────────────────────────────────────────────────────────────

export type VisitHandoff = {
  next_check_items: string[];
  ongoing_monitoring: string[];
  decision_rationale: string | null;
  ai_extracted: boolean;
  ai_confidence: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  extracted_at: string | null;
};
