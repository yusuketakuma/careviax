// ─── Care Report Content Types ───────────────────────────────────────────────
// 医師向け報告書・ケアマネ向け情報提供書のコンテンツ型定義
// 厚労省「在宅患者訪問薬剤管理指導ガイド」準拠

import type { VitalSigns } from './structured-soap';
import type { OutsideMedEvidenceKind } from '@/lib/dispensing/set-audit-constants';

export type { VitalSigns };

export type BaselineContext = {
  care_level?: string;
  adl_level?: string;
  dementia_level?: string;
  special_medical_procedures?: string[];
  primary_disease?: string;
  requester?: {
    contact_name?: string;
    organization_name?: string;
    profession?: string;
    phone?: string;
    fax?: string;
  };
};

export type PhysicianReportContent = {
  patient: { name: string; birth_date: string; gender: string };
  report_date: string;
  visit_date: string;
  pharmacist_name: string;
  prescriber: { name: string; institution: string };
  baseline_context?: BaselineContext;
  prescriptions: Array<{
    drug_name: string;
    dose: string;
    frequency: string;
    days: number;
    route?: string;
    dispensing_method?: string;
    outside_med_kind?: OutsideMedEvidenceKind | null;
    outside_med_label?: string | null;
  }>;
  medication_management: {
    compliance_summary: string;
    adherence_score: number;
    self_management: string;
    calendar_used: boolean;
  };
  adverse_events: { has_events: boolean; events: string[]; details?: string };
  functional_assessment: {
    lab_values?: string;
    sleep: string;
    cognition: string;
    diet_oral: string;
    mobility: string;
    excretion: string;
  };
  residual_medications: Array<{
    drug_name: string;
    remaining_qty: number;
    excess_days: number;
    reduction_proposal: boolean;
  }>;
  assessment: string;
  plan: string;
  prescription_proposals?: string;
  physician_communication: string;
  warnings: string[];
};

export type CareManagerReportContent = {
  patient: { name: string; birth_date: string };
  care_manager: { name: string; organization: string };
  report_date: string;
  visit_date: string;
  pharmacist_name: string;
  baseline_context?: BaselineContext;
  medication_management_summary: {
    total_drugs: number;
    compliance_summary: string;
    self_management: string;
    calendar_used: boolean;
  };
  functional_impact: {
    sleep_impact: string;
    cognition_impact: string;
    diet_impact: string;
    mobility_impact: string;
    excretion_impact: string;
  };
  residual_status: {
    summary: string;
    reduction_proposals: string[];
  };
  care_service_coordination: {
    medication_assistance: string;
    unit_dose_packaging: boolean;
    calendar_recommendation: boolean;
    other_items: string;
  };
  next_visit_plan: {
    date?: string;
    followup_items: string[];
  };
  warnings: string[];
};

export type AudienceReportAudience = 'visiting_nurse' | 'facility' | 'family';

export type AudienceReportContent = {
  report_audience: AudienceReportAudience;
  patient: { name: string; birth_date: string };
  report_date: string;
  visit_date: string;
  pharmacist_name: string;
  summary: string;
  medication: string;
  residual: string;
  evaluation: string;
  requests: string;
  warnings: string[];
  baseline_context?: BaselineContext;
};

// ─── CareReport.content 投影メタ (billing_context / source_provenance) ─────────
// report-generator / care-reports API / partner-visit-report-drafts が
// CareReport.content 直下へ埋め込む請求根拠・来歴メタの JSON 形状を型で固定する。
// 値・キー・順序は既存構築ロジックと 1 対 1 対応（形状を変えない）。

// billingEvidence を content.billing_context へ射影した形状。
// applied_rule_keys / recommended_rule_keys は BillingEvidence の Json 列由来のため
// 不透明 JSON として扱う（構築側で `?? []` を通してから格納する）。
export type CareReportBillingContext = {
  billing_evidence_id: string;
  payer_basis: string;
  claimable: boolean;
  exclusion_reason: string | null;
  report_delivery_ref: string | null;
  applied_rule_keys: unknown;
  recommended_rule_keys: unknown;
  validation_notes: string | null;
  updated_at: string | null;
  effective_revision_code: string | null;
  site_config_status: string | null;
  site_config_revision_code: string | null;
  jahis_supplemental_record_count: number | null;
  jahis_residual_confirmation_count: number | null;
};

// content.source_provenance は生成経路ごとに異なる形状を取る discriminated union。
// `source` タグで判別する（visit_record 経路は歴史的経緯でタグを省略し得るため optional）。

// report-generator（訪問記録からの完全生成）が埋める完全版来歴。
export type CareReportVisitRecordSourceProvenance = {
  schema_version: number;
  visit_record_id: string;
  visit_record_version: number | null;
  visit_record_updated_at: string | null;
  schedule_id: string;
  patient_id: string;
  case_id: string;
  medication_cycle_id: string | null;
  prescription_intake_ids: string[];
  prescription_line_ids: string[];
  prescription_lines: Array<{
    prescription_line_id: string;
    prescription_intake_id: string;
    prescribed_date: string;
    drug_code: string | null;
    drug_name: string;
    quantity: number | null;
    unit: string | null;
  }>;
  billing_evidence_id: string | null;
  billing_evidence_updated_at: string | null;
  latest_lab_observations: Array<{
    id: string;
    analyte_code: string;
    measured_at: string;
    abnormal_flag: string | null;
  }>;
  patient_insurance_basis: {
    payer_basis: string;
    patient_id: string | null;
    cycle_id: string | null;
    claimable: boolean;
    exclusion_reason: string | null;
  } | null;
  generated_at: string;
  source?: 'visit_record';
};

// care-reports API の手動作成経路が埋める簡易版来歴。
// billing 系フィールドを持たない（手動作成時点では billingEvidence 未確定）。
export type CareReportManualSourceProvenance = {
  schema_version: number;
  visit_record_id: string;
  visit_record_version: number;
  visit_record_updated_at: string;
  generated_at: string;
  source: 'manual_care_report_create';
};

// 協力薬局訪問記録からの下書き生成が埋める来歴。独立メンバー（billing 系を持たない）。
export type CareReportPartnerVisitSourceProvenance = {
  schema_version: number;
  source: 'partner_visit_record';
  partner_visit_record_id: string;
  partner_visit_record_revision_no: number;
  partner_visit_record_updated_at: string;
  visit_request_id: string;
  share_case_id: string;
  owner_partner_pharmacy_id: string;
  generated_at: string;
};

export type CareReportSourceProvenance =
  | CareReportVisitRecordSourceProvenance
  | CareReportManualSourceProvenance
  | CareReportPartnerVisitSourceProvenance;
