export type PatientMovementEventType =
  | 'visit_schedule'
  | 'visit_record'
  | 'prescription_intake'
  | 'dispense_result'
  | 'inquiry'
  | 'care_report'
  | 'delivery_record'
  | 'management_plan'
  | 'first_visit_document'
  | 'conference_note'
  | 'billing_candidate'
  | 'operation_history'
  | 'self_report'
  | 'communication'
  | 'external_share'
  | 'visit_event'
  | 'prescription_event'
  | 'document_registered'
  | 'inbound_communication'
  | 'inbound_mcs'
  | 'inbound_phone'
  | 'inbound_fax'
  | 'inbound_email'
  | 'inbound_medication_stock_signal'
  | 'medication_stock_event'
  | 'medication_stock_snapshot'
  | 'medication_equivalence_review'
  | 'interprofessional_note'
  | 'care_team_update'
  | 'safety_signal'
  | 'task_created'
  | 'task_resolved'
  | 'support_session';

export type PatientMovementCategory =
  | 'visit'
  | 'prescription'
  | 'medication_stock'
  | 'interprofessional'
  | 'communication'
  | 'document'
  | 'billing'
  | 'task'
  | 'safety'
  | 'system';

export type PatientMovementSeverity = 'blocking' | 'urgent' | 'warning' | 'info' | 'normal';

export type PatientMovementBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type PatientMovementPrivacyLevel = 'summary' | 'detail' | 'raw_phi';

export type PatientMovementTimelineEvent<TDate = string> = {
  id: string;
  event_type: PatientMovementEventType;
  category: PatientMovementCategory;
  occurred_at: TDate;
  recorded_at?: TDate | null;
  title: string;
  summary: string | null;
  href: string;
  action_label: string;
  status: string | null;
  status_label: string | null;
  actor_name: string | null;
  actor_role: string | null;
  source_channel: string | null;
  source_label: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  severity: PatientMovementSeverity;
  badges: Array<{
    label: string;
    tone: PatientMovementBadgeTone;
  }>;
  metadata: string[];
  privacy_level: PatientMovementPrivacyLevel;
  raw_available: boolean;
};

export type PatientMovementTimelineEventDetail<TDate = string> = {
  patient_id: string;
  event_id: string;
  event: PatientMovementTimelineEvent<TDate>;
  destination: {
    href: string;
    label: string;
    related_entity_type: string | null;
    related_entity_id: string | null;
  };
  raw_text: {
    available: boolean;
    included: false;
    reason: string;
  };
};
