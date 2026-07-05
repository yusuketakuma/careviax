export type CaseRiskDomain =
  | 'patient_foundation'
  | 'consent_plan'
  | 'medication'
  | 'dispensing'
  | 'visit_preparation'
  | 'visit_record'
  | 'report_delivery'
  | 'billing'
  | 'task_sla'
  | 'notification'
  | 'privacy_security'
  | 'integration'
  | 'data_quality';

export type CaseRiskSeverity = 'blocking' | 'urgent' | 'warning' | 'info';
export type CaseRiskResolutionState = 'open' | 'acknowledged' | 'resolved' | 'waived';
export type CaseRiskCockpitStatus = 'ready' | 'attention' | 'blocked';
export type CaseRiskFindingSource = 'computed' | 'manual' | 'external';

export type CaseRiskFinding = {
  key: string;
  domain: CaseRiskDomain;
  severity: CaseRiskSeverity;
  title: string;
  detail: string;
  patient_id?: string | null;
  case_id?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  assigned_to?: string | null;
  due_at?: string | null;
  action_href: string;
  action_label: string;
  resolution_state: CaseRiskResolutionState;
  source: CaseRiskFindingSource;
};

export type CaseRiskCockpitSection = {
  domain: CaseRiskDomain;
  label: string;
  status: CaseRiskCockpitStatus;
  findings: CaseRiskFinding[];
};

export type CaseRiskNextAction = {
  task_id?: string | null;
  label: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  due_at: string | null;
  action_href: string;
};

export type CaseRiskCockpitResponse = {
  generated_at: string;
  patient: { id: string; display_id?: string | null; name: string };
  case: { id: string; display_id?: string | null; status: string };
  overall: {
    status: CaseRiskCockpitStatus;
    blocking_count: number;
    urgent_count: number;
    warning_count: number;
  };
  sections: CaseRiskCockpitSection[];
  next_actions: CaseRiskNextAction[];
};
