import type { ImpactQueueKey } from './drug-master-formulary-view-model';

export type DrugMasterRow = {
  id: string;
  yj_code: string;
  receipt_code: string | null;
  jan_code: string | null;
  drug_name: string;
  drug_name_kana: string | null;
  generic_name: string | null;
  drug_price: number | null;
  unit: string | null;
  dosage_form: string | null;
  therapeutic_category: string | null;
  manufacturer: string | null;
  is_generic: boolean;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  is_high_risk: boolean;
  outpatient_injection_eligible: boolean;
  outpatient_injection_note: string | null;
  is_lasa_risk: boolean;
  tall_man_name: string | null;
  lasa_group_key: string | null;
  max_administration_days: number | null;
  stock_config: PharmacyDrugStockConfig | null;
};

export type DrugMasterImportLog = {
  id: string;
  source: 'ssk' | 'pmda' | 'mhlw_price' | 'mhlw_generic' | 'hot' | 'manual_clinical';
  imported_at: string;
  record_count: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error_log: string | null;
  source_url: string | null;
  source_file_hash: string | null;
  source_published_at: string | null;
  import_mode: string | null;
  change_summary: unknown | null;
};

export type ImportAction = 'ssk' | 'mhlw-price' | 'mhlw-generic' | 'hot' | 'pmda';
export type FormularyExportPurpose = 'operations' | 'audit' | 'posting' | 'pharmacist_review';

export type DrugMasterDetail = DrugMasterRow & {
  hot_code: string | null;
  transitional_expiry_date: string | null;
  package_inserts: Array<{
    id: string;
    contraindications: unknown;
    interactions: unknown;
    adverse_effects: unknown;
    dosage_adjustment_renal: unknown;
    precautions_elderly: unknown;
    document_version: string | null;
    revised_at: string | null;
  }>;
  interactions_as_a: Array<{
    id: string;
    severity: 'contraindicated' | 'caution' | 'minor';
    mechanism: string | null;
    clinical_effect: string | null;
    source: 'pmda_xml' | 'kegg' | 'manual';
    drug_b: { id: string; drug_name: string; yj_code: string };
  }>;
  interactions_as_b: Array<{
    id: string;
    severity: 'contraindicated' | 'caution' | 'minor';
    mechanism: string | null;
    clinical_effect: string | null;
    source: 'pmda_xml' | 'kegg' | 'manual';
    drug_a: { id: string; drug_name: string; yj_code: string };
  }>;
};

export type PharmacySiteOption = {
  id: string;
  name: string;
  address: string;
};

export type PreferredGenericSummary = {
  id: string;
  drug_name: string;
  yj_code: string;
};

export type GenericCandidateOption = {
  id: string;
  yj_code: string;
  drug_name: string;
};

export type GenericRecommendation = GenericCandidateOption & {
  generic_name: string | null;
  drug_price: number | null;
  unit: string | null;
  manufacturer: string | null;
  is_generic: boolean;
  transitional_expiry_date: string | null;
  price_delta: number | null;
  price_delta_percent: number | null;
  site_stock: {
    drug_master_id: string;
    is_stocked: boolean;
    preferred_generic_id: string | null;
    reorder_point: number | null;
  } | null;
};

export type IngredientGroupResponse = {
  site: Pick<PharmacySiteOption, 'id' | 'name'> | null;
  target: Pick<
    DrugMasterRow,
    'id' | 'yj_code' | 'drug_name' | 'generic_name' | 'drug_price' | 'unit' | 'is_generic'
  >;
  generic_name: string | null;
  summary: {
    member_count: number;
    brand_count: number;
    generic_count: number;
    stocked_count: number;
    unstocked_count: number | null;
    lowest_price: number | null;
    highest_price: number | null;
  } | null;
  members: Array<
    Pick<
      DrugMasterRow,
      | 'id'
      | 'yj_code'
      | 'drug_name'
      | 'generic_name'
      | 'drug_price'
      | 'unit'
      | 'manufacturer'
      | 'is_generic'
    > & {
      transitional_expiry_date: string | null;
      site_stock: {
        drug_master_id: string;
        is_stocked: boolean;
        preferred_generic_id: string | null;
        reorder_point: number | null;
        follow_up_status: string | null;
      } | null;
    }
  >;
  reason?: 'generic_name_missing';
};

export type PharmacyDrugStockConfig = {
  id: string;
  site_id: string;
  drug_master_id: string;
  is_stocked: boolean;
  stock_qty: number | null;
  reorder_point: number | null;
  preferred_generic_id: string | null;
  adoption_source: string | null;
  adoption_note: string | null;
  last_reviewed_at: string | null;
  reviewed_by_id: string | null;
  follow_up_status: string | null;
  follow_up_reason: string | null;
  follow_up_due_date: string | null;
  follow_up_resolved_at: string | null;
  updated_at: string;
  preferred_generic: PreferredGenericSummary | null;
};

export type FormularyStockSummaryRow = PharmacyDrugStockConfig & {
  drug_master: {
    id: string;
    drug_name: string;
    yj_code: string;
    drug_price: number | null;
    unit: string | null;
    is_generic: boolean;
    is_narcotic: boolean;
    is_psychotropic: boolean;
    is_high_risk: boolean;
    is_lasa_risk: boolean;
    transitional_expiry_date: string | null;
  };
};

export type FormularyRecentChange = {
  id: string;
  yj_code: string;
  change_type: string;
  previous_value: unknown;
  current_value: unknown;
  created_at: string;
};

export type FormularyImpactResponse = {
  recent_changes: FormularyRecentChange[];
  totals: {
    stocked_count: number;
    review_due_count: number;
    missing_reorder_point_count: number;
    safety_flagged_count: number;
    high_risk_count: number;
    lasa_risk_count: number;
    controlled_count: number;
    transitional_expiry_count: number;
    transitional_expiry_within_30_count: number;
    transitional_expiry_within_60_count: number;
    transitional_expiry_within_90_count: number;
    action_required_count: number;
    recent_master_change_count: number;
  };
  selected_queue: {
    key: ImpactQueueKey;
    rows: FormularyStockSummaryRow[];
    total_count: number;
  };
  master_change_report?: {
    cutoff: string;
    total_count: number;
    sampled_count: number;
    is_truncated: boolean;
    change_type_counts: Array<{ change_type: string; count: number }>;
    rows: Array<{
      stock: FormularyStockSummaryRow;
      changes: FormularyRecentChange[];
    }>;
    price_impact?: {
      usage_window_days: number;
      scanned_draft_count: number;
      estimated_total_delta: number;
      rows: Array<{
        stock: FormularyStockSummaryRow;
        previous_price: number | null;
        current_price: number | null;
        unit_price_delta: number | null;
        usage_count: number;
        estimated_total_delta: number | null;
      }>;
    };
  };
  follow_up_summary?: {
    unresolved_count: number;
    overdue_count: number;
    missing_due_date_count: number;
  };
  samples: {
    review_due: FormularyStockSummaryRow[];
    missing_reorder_point: FormularyStockSummaryRow[];
    safety_flagged: FormularyStockSummaryRow[];
    high_risk: FormularyStockSummaryRow[];
    lasa_risk: FormularyStockSummaryRow[];
    controlled: FormularyStockSummaryRow[];
    transitional_expiry: FormularyStockSummaryRow[];
    action_required: FormularyStockSummaryRow[];
    recently_changed: FormularyStockSummaryRow[];
  };
};

export type FormularyUsageMismatchResponse = {
  period: {
    since: string;
    until: string;
  };
  thresholds: {
    days: number;
    frequent_threshold: number;
    draft_limit: number;
    limit: number;
  };
  totals: {
    scanned_draft_count: number;
    used_drug_count: number;
    medication_line_count: number;
    matched_drug_count: number;
    unmatched_drug_count: number;
    stocked_count: number;
    frequent_unstocked_count: number;
    unused_stocked_count: number;
    displayed_frequent_unstocked_count: number;
    displayed_unused_stocked_count: number;
  };
  frequent_unstocked: Array<{
    drug_code: string | null;
    drug_name: string | null;
    count: number;
    last_seen_at: string;
    matched_drug: Pick<
      DrugMasterRow,
      'id' | 'yj_code' | 'drug_name' | 'generic_name' | 'drug_price' | 'unit' | 'is_generic'
    > | null;
  }>;
  unused_stocked: Array<
    Pick<PharmacyDrugStockConfig, 'id' | 'drug_master_id' | 'reorder_point' | 'updated_at'> & {
      drug_master: Pick<
        DrugMasterRow,
        'id' | 'yj_code' | 'drug_name' | 'generic_name' | 'drug_price' | 'unit' | 'is_generic'
      >;
    }
  >;
  unmatched_prescribed: Array<{
    drug_code: string | null;
    drug_name: string | null;
    count: number;
    last_seen_at: string;
  }>;
};

export type BulkPreviewResponse = {
  importedCount: number;
  unmatchedRows: Array<{ rowNumber: number; yj_code?: string; drug_name?: string }>;
  invalidRows: Array<{
    rowNumber: number;
    reason: string;
    candidates?: Array<{
      id: string;
      yj_code: string;
      drug_name: string;
      generic_name: string | null;
    }>;
  }>;
  preview: {
    summary: {
      totalRows: number;
      processableRows: number;
      createCount: number;
      updateCount: number;
      deactivateCount: number;
      noChangeCount: number;
      unmatchedCount: number;
      invalidCount: number;
    };
    rows: Array<{
      rowNumber: number;
      status: 'create' | 'update' | 'deactivate' | 'no_change' | 'unmatched' | 'invalid';
      yj_code?: string;
      drug_name?: string;
      reason?: string;
      candidates?: Array<{
        id: string;
        yj_code: string;
        drug_name: string;
        generic_name: string | null;
      }>;
    }>;
  };
};

export type FormularyCopyPreviewResponse = {
  sourceCount: number;
  copiedCount: number;
  skippedCount: number;
  overwrite: boolean;
  dryRun: boolean;
  preview: {
    summary: {
      source_count: number;
      create_count: number;
      update_count: number;
      skip_existing_count: number;
      apply_count: number;
    };
    rows: Array<{
      action: 'create' | 'update' | 'skip_existing';
      drug_master_id: string;
      reorder_point: number | null;
      preferred_generic_id: string | null;
      drug_master: {
        id: string;
        yj_code: string;
        drug_name: string;
      };
    }>;
  };
};

export type FormularyTemplatePreviewResponse = {
  itemCount: number;
  appliedCount: number;
  skippedCount: number;
  overwrite: boolean;
  dryRun: boolean;
  preview: {
    summary: {
      item_count: number;
      create_count: number;
      update_count: number;
      skip_existing_count: number;
      apply_count: number;
    };
    rows: Array<{
      action: 'create' | 'update' | 'skip_existing';
      drug_master_id: string;
      reorder_point: number | null;
      preferred_generic_id: string | null;
      drug_master: {
        id: string;
        yj_code: string;
        drug_name: string;
      };
    }>;
  };
};

export type OfficialImportPreviewData = {
  dryRun?: boolean;
  mode?: string;
  workbookUrl?: string | null;
  workbookUrls?: string[];
  sourceFileHash?: string | null;
  sourcePublishedAt?: string | null;
  preview?: {
    summary?: Record<string, unknown>;
    rows?: unknown[];
  };
  flags?: OfficialImportPreviewData | null;
  mappings?: OfficialImportPreviewData | null;
};

export type OfficialImportPreviewState = {
  action: ImportAction;
  data: OfficialImportPreviewData;
};

export type FormularyTemplateItem = {
  id: string;
  name: string;
  description: string | null;
  source_site_id: string | null;
  item_count: number;
  created_at: string;
};

export type PharmacyDrugStockHistoryItem = {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  changes: unknown;
  created_at: string;
};

export type FormularyChangeRequestItem = {
  id: string;
  site_id: string;
  drug_master_id: string;
  status: 'pending' | 'approved' | 'rejected';
  action_type: string;
  requested_payload: unknown;
  reason: string | null;
  created_at: string;
};

export type FormularyChangeRequestListResponse = {
  data: FormularyChangeRequestItem[];
  summary: {
    status: 'pending' | 'approved' | 'rejected';
    total_count: number;
    overdue_count: number;
    overdue_days: number;
    oldest_pending_created_at: string | null;
    notification_level: 'clear' | 'pending' | 'overdue';
  };
};

export type FormularyRequestDecisionTarget = {
  request: FormularyChangeRequestItem;
  decision: 'approve' | 'reject';
};

export type DrugMasterContentProps = {
  variant?: 'master' | 'formulary';
};
