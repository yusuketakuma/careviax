export type PatientHomeOperationKey =
  | 'documents'
  | 'mcs'
  | 'prescription'
  | 'billing'
  | 'conference';

export type PatientHomeOperationTone = 'ok' | 'attention' | 'neutral';

export type PatientHomeOperationMetric = {
  label: string;
  value: string;
};

export type PatientHomeOperationActionKey =
  | 'mark_fax_original_collected'
  | 'save_prescription_document'
  | 'record_prescription_original_management'
  | 'record_billing_payment_profile'
  | 'record_billing_collection'
  | 'record_conference_note'
  | 'record_mcs_check_log';

export type PatientHomeOperationQuickAction = {
  key: PatientHomeOperationActionKey;
  label: string;
  resource_id: string;
};

export type PatientHomeOperationAlert = {
  id: string;
  key: PatientHomeOperationKey;
  label: string;
  message: string;
  href: string;
  action_label: string;
};

export type PatientHomeOperationItem = {
  key: PatientHomeOperationKey;
  label: string;
  status: string;
  description: string;
  href: string;
  action_label: string;
  external_href?: string | null;
  external_action_label?: string | null;
  tone: PatientHomeOperationTone;
  updated_at: string | null;
  metrics: PatientHomeOperationMetric[];
  alerts: string[];
  quick_actions?: PatientHomeOperationQuickAction[];
};

export type PatientHomeOperationsSnapshot = {
  generated_at: string;
  attention_count: number;
  top_alerts: PatientHomeOperationAlert[];
  items: PatientHomeOperationItem[];
};
