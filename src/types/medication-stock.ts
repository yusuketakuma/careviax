export type MedicationStockRiskLevelDto =
  | 'ok'
  | 'watch'
  | 'shortage_expected'
  | 'urgent'
  | 'unknown';

export type MedicationStockEquivalenceReviewStatusDto =
  | 'not_required'
  | 'needs_review'
  | 'reviewed'
  | 'uncertain';

export type MedicationStockEquivalenceConfidenceDto =
  | 'exact_code'
  | 'ingredient_strength_form'
  | 'ingredient_only'
  | 'manual'
  | 'uncertain';

export type PatientMedicationStockSnapshotStatus = 'available' | 'missing' | 'unit_mismatch';

export type PatientMedicationStockItemDto = {
  id: string;
  display_id: string | null;
  patient_id: string;
  case_id: string | null;
  display_name: string;
  normalized_name: string | null;
  ingredient_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  route: string | null;
  unit: string;
  source_type: string;
  medication_category: string;
  managing_party: string;
  equivalence_review_status: MedicationStockEquivalenceReviewStatusDto;
  equivalence_confidence: MedicationStockEquivalenceConfidenceDto | null;
  active: boolean;
  snapshot_status: PatientMedicationStockSnapshotStatus;
  snapshot: {
    current_quantity: number | null;
    last_observed_quantity: number | null;
    last_observed_at: string | null;
    estimated_daily_usage: number | null;
    usage_confidence: string;
    estimated_stockout_date: string | null;
    days_until_stockout: number | null;
    stock_risk_level: MedicationStockRiskLevelDto;
    risk_reason_code: string | null;
    calculated_at: string | null;
  } | null;
};

export type PatientMedicationStockEventDto = {
  id: string;
  stock_item_id: string;
  event_type: string;
  event_at: string;
  recorded_at: string;
  quantity_kind: string;
  quantity_delta: number | null;
  observed_quantity: number | null;
  usage_quantity: number | null;
  usage_period_days: number | null;
  unit: string;
  source_entity_type: string;
  has_source_entity: boolean;
};

export type PatientMedicationStockSummaryResponse = {
  data: {
    patient_id: string;
    summary: {
      total_item_count: number;
      visible_item_count: number;
      active_item_count: number;
      urgent_count: number;
      shortage_expected_count: number;
      watch_count: number;
      unknown_risk_count: number;
      usage_unknown_count: number;
      equivalence_review_count: number;
      pending_external_observation_count: number;
      last_observed_at: string | null;
    };
    items: PatientMedicationStockItemDto[];
    recent_events: PatientMedicationStockEventDto[];
  };
  meta: {
    generated_at: string;
    item_limit: number;
    event_limit: number;
    visible_count: number;
    hidden_count: number;
    count_basis: 'limited_items';
    partial_failures: [];
  };
};

export type VisitMedicationStockObservationKindDto =
  | 'observed_absolute'
  | 'usage_delta'
  | 'usage_frequency'
  | 'not_observed'
  | 'refill_request';

export type VisitMedicationStockObservationSourcePreset =
  | 'pharmacist_counted'
  | 'patient_reported'
  | 'caregiver_reported'
  | 'facility_staff_reported'
  | 'other_institution_record';

export type VisitMedicationStockUnobservedReasonCode =
  | 'patient_refused'
  | 'caregiver_unavailable'
  | 'storage_inaccessible'
  | 'medication_not_present'
  | 'identity_uncertain'
  | 'visit_time_limited'
  | 'safety_priority'
  | 'other_institution_unconfirmed'
  | 'unknown';

export type VisitMedicationStockObservationDraft = {
  client_observation_id: string;
  stock_item_id: string;
  unit: string;
  kind: VisitMedicationStockObservationKindDto;
  quantity_input: string;
  used_quantity_input: string;
  usage_quantity_input: string;
  usage_period_days_input: string;
  last_used_date: string;
  unobserved_reason_code: VisitMedicationStockUnobservedReasonCode | '';
  source_preset: VisitMedicationStockObservationSourcePreset | '';
};

export type VisitMedicationStockObservationDraftField =
  | 'client_observation_id'
  | 'stock_item_id'
  | 'unit'
  | 'kind'
  | 'quantity_input'
  | 'used_quantity_input'
  | 'usage_quantity_input'
  | 'usage_period_days_input'
  | 'last_used_date'
  | 'unobserved_reason_code'
  | 'source_preset';

export type VisitMedicationStockObservationDraftErrors = Record<
  string,
  Partial<Record<VisitMedicationStockObservationDraftField, string>>
>;

export type VisitMedicationStockObservationRequest = {
  observed_at: string;
  observations: Array<{
    client_observation_id: string;
    stock_item_id: string;
    kind: VisitMedicationStockObservationKindDto;
    unit: string;
    quantity?: number;
    used_quantity?: number;
    usage_quantity?: number;
    usage_period_days?: number;
    last_used_at?: string;
    last_used_precision?: 'date_only';
    unobserved_reason_code?: VisitMedicationStockUnobservedReasonCode;
    source_confidence: 'structured_exact' | 'structured_partial' | 'manual';
    source_context_code:
      | 'pharmacist_direct_observation'
      | 'patient_report'
      | 'caregiver_report'
      | 'facility_staff_report'
      | 'record_review';
    confirmation_level:
      | 'counted_by_pharmacist'
      | 'patient_reported'
      | 'caregiver_reported'
      | 'other_professional_reported'
      | 'other_institution_record';
  }>;
};

export type VisitMedicationStockObservationResponse = {
  data: {
    visit_record_id: string;
    observations: Array<{
      client_observation_id: string;
      stock_item_id: string;
      stock_event_id: string;
      observation_context_id: string;
      event_type: 'visit_observation';
      observation_kind: VisitMedicationStockObservationKindDto;
      quantity_kind: 'delta' | 'observed_absolute' | 'usage_rate' | 'no_quantity';
      snapshot: {
        current_quantity: number | null;
        stock_risk_level: MedicationStockRiskLevelDto;
        calculated_at: string;
      };
      idempotent_replay: boolean;
    }>;
  };
  meta: {
    generated_at: string;
    applied_count: number;
    replay_count: number;
  };
};
