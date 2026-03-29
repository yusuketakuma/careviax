// ─── Care Report Content Types ───────────────────────────────────────────────
// 医師向け報告書・ケアマネ向け情報提供書のコンテンツ型定義
// 厚労省「在宅患者訪問薬剤管理指導ガイド」準拠

import type { VitalSigns } from './structured-soap';

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
