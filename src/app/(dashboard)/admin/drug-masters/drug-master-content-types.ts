export type {
  BulkPreviewResponse,
  DrugMasterDetail,
  DrugMasterImportLog,
  FormularyCopyPreviewResponse,
  FormularyImpactResponse,
  FormularyRecentChange,
  FormularyStockSummaryRow,
  FormularyTemplateItem,
  FormularyTemplatePreviewResponse,
  FormularyUsageMismatchResponse,
  GenericCandidateOption,
  GenericRecommendation,
  IngredientGroupResponse,
  PharmacySiteOption,
} from './drug-master-content-contracts';

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

export type ImportAction = 'ssk' | 'mhlw-price' | 'mhlw-generic' | 'hot' | 'pmda';
export type FormularyExportPurpose = 'operations' | 'audit' | 'posting' | 'pharmacist_review';

export type PreferredGenericSummary = {
  id: string;
  drug_name: string;
  yj_code: string;
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

export type OfficialImportPreviewData =
  import('./drug-master-content-contracts').OfficialImportPreviewData;

export type OfficialImportPreviewState = {
  action: ImportAction;
  data: OfficialImportPreviewData;
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
