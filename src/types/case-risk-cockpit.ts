import type {
  RiskCockpitStatus,
  RiskDomain,
  RiskFinding,
  RiskFindingSource,
  RiskResolutionState,
  RiskSeverity,
} from '@/lib/risk/risk-finding';

export type CaseRiskDomain = RiskDomain;
export type CaseRiskSeverity = RiskSeverity;
export type CaseRiskResolutionState = RiskResolutionState;
export type CaseRiskCockpitStatus = RiskCockpitStatus;
export type CaseRiskFindingSource = RiskFindingSource;
export type CaseRiskFinding = RiskFinding;

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
