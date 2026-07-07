export type MedicationStockRiskLevelDto =
  | 'ok'
  | 'watch'
  | 'shortage_expected'
  | 'urgent'
  | 'unknown';

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
  equivalence_review_status: string;
  equivalence_confidence: string | null;
  active: boolean;
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
  };
};
