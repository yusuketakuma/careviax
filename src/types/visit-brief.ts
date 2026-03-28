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

export type VisitBrief = {
  patient: {
    id: string;
    name: string;
  };
  context: VisitBriefContext;
  generated_at: string;
  last_prescribed_date: string | null;
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
};
