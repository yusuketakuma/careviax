import type { Prisma } from '@prisma/client';

export type ConsentRow = {
  id: string;
  expiry_date: Date | null;
};

export type ManagementPlanRow = {
  id: string;
  next_review_date: Date | null;
};

export type FirstVisitDocumentRow = {
  id: string;
  delivered_at: Date | null;
};

export type VisitScheduleRow = {
  id: string;
  display_id: string | null;
  schedule_status: string;
  scheduled_date: Date;
  carry_items_status: string | null;
  preparation: {
    id: string;
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    offline_synced: boolean;
  } | null;
  visit_record: {
    id: string;
  } | null;
};

export type CareReportRow = {
  id: string;
  display_id: string | null;
  status: string;
  updated_at: Date;
};

export type DispenseTaskRow = {
  id: string;
  priority: string | null;
  status: string;
  assigned_to: string | null;
  due_date: Date | null;
};

export type PrescriptionLineRiskRow = {
  id: string;
  drug_master_id: string | null;
  drug_resolution_status: string | null;
};

export type MedicationStockSnapshotRiskRow = {
  id: string;
  stock_item_id: string;
  patient_id: string;
  case_id: string | null;
  stock_risk_level: 'urgent' | 'shortage_expected';
  estimated_stockout_date: Date | null;
  days_until_stockout: number | null;
  calculated_at: Date;
};

export type NotificationRiskRow = {
  id: string;
  type: string;
  event_type: string | null;
  link: string | null;
  created_at: Date;
};

export type ResidenceRiskRow = {
  id: string;
  lat: number | null;
  lng: number | null;
  geocode_status: string | null;
  geocode_accuracy: string | null;
  updated_at: Date;
};

export type PatientMcsLinkRiskRow = {
  id: string;
  last_sync_status: string | null;
  last_sync_attempt_at: Date | null;
  last_synced_at: Date | null;
  updated_at: Date;
};

export type InboundInterprofessionalCommunicationRiskSummary = {
  has_inbound_communication: boolean;
  latest_occurred_at: Date | null;
  unprocessed_event_count?: number;
  needs_review_signal_count?: number;
  medication_stock_signal_count?: number;
  safety_signal_count?: number;
  schedule_signal_count?: number;
  unlinked_medication_stock_signal_count?: number;
  legacy_inbound_event_count?: number;
};

export type PatientShareCaseRiskRow = {
  id: string;
  status: string;
  share_scope: Prisma.JsonValue | null;
  ends_at: Date | null;
  updated_at: Date;
  consents: Array<{
    id: string;
    consent_date: Date;
    valid_until: Date | null;
    revoked_at: Date | null;
  }>;
};

export type TaskRow = {
  id: string;
  task_type: string;
  title: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: string;
  assigned_to: string | null;
  due_date: Date | null;
  sla_due_at: Date | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

export type BillingEvidenceRow = {
  id: string;
  patient_id: string | null;
  visit_record_id: string | null;
  claimable: boolean;
  exclusion_reason: string | null;
  same_month_exclusion_flags: Prisma.JsonValue | null;
  validation_notes: Prisma.JsonValue | null;
};

export type CaseRiskProviderInput = {
  patientHref: string;
  patientId: string;
  caseId: string;
  now: Date;
  consent: ConsentRow | null;
  managementPlan: ManagementPlanRow | null;
  firstVisitDocument: FirstVisitDocumentRow | null;
  schedules: VisitScheduleRow[];
  reports: CareReportRow[];
  dispenseTasks: DispenseTaskRow[];
  prescriptionLines: PrescriptionLineRiskRow[];
  medicationStockSnapshots: MedicationStockSnapshotRiskRow[];
  notifications: NotificationRiskRow[];
  residences: ResidenceRiskRow[];
  patientMcsLinks: PatientMcsLinkRiskRow[];
  inboundInterprofessionalCommunication: InboundInterprofessionalCommunicationRiskSummary;
  patientShareCases: PatientShareCaseRiskRow[];
  tasks: TaskRow[];
  visitRecordIds: Set<string>;
  billingEvidence: BillingEvidenceRow[];
};
