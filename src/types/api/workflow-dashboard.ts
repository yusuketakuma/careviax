export type QueuePriority = 'urgent' | 'high' | 'normal' | 'low';

export type RemediationGuidanceItem = {
  id: string;
  title: string;
  description: string;
  severity: 'urgent' | 'high' | 'normal';
  count: number;
  action_href: string;
  action_label: string;
};

export type WorkbenchItem = {
  id: string;
  item_type: 'task' | 'proposal' | 'visit' | 'self_report' | 'aggregate';
  queue_label: string;
  title: string;
  summary: string;
  priority: QueuePriority;
  due_at: string | null;
  action_href: string;
  action_label: string;
  owner_name: string | null;
  patient_name: string | null;
  badges: string[];
};

export type RouteOperations = {
  locked_confirmed_visits: number;
  fallback_assignments: number;
  override_pending: number;
  emergency_candidates: number;
};

export type RoleInboxBucket = {
  role: 'pharmacist' | 'clerk' | 'admin';
  label: string;
  open_items: number;
  urgent_items: number;
  communication_items: number;
  action_href: string;
};

export type WorkflowDashboardResponse = {
  data: {
    cycle_status_counts: Record<string, number>;
    workflow_exceptions: {
      open: number;
      items: Array<{
        id: string;
        exception_type: string;
        description: string;
        severity: string;
        patient_name: string | null;
        created_at: string;
      }>;
    };
    communication_requests: {
      pending: number;
      overdue: number;
    };
    delivery: {
      failures: number;
    };
    visit_operations: {
      overdue: number;
      awaiting_reports: number;
      missing_visit_consent: number;
      missing_management_plan: number;
      missing_first_visit_doc: number;
      missing_emergency_contact: number;
      missing_primary_physician: number;
    };
    operations_queue: {
      visit_demands: number;
      callback_followups: number;
      management_plan_reviews: number;
      preparation_pending: number;
      geocode_reviews: number;
      intake_linkages: number;
      self_reports_triage: number;
    };
    role_inboxes: {
      current_role: string;
      buckets: RoleInboxBucket[];
    };
    communication_queue: unknown;
    patient_risk_queue: {
      high_risk_count: number;
      items: unknown[];
    };
    inquiry_workbench: unknown[];
    remediation_guidance: RemediationGuidanceItem[];
    unified_workbench: WorkbenchItem[];
    facility_visibility: {
      clusters: unknown[];
    };
    exception_command_center: unknown[];
    workload_metrics: {
      pharmacists: unknown[];
    };
    route_operations: RouteOperations;
    outcome_metrics: {
      completed_last_7_days: number;
      disrupted_last_7_days: number;
      urgent_completed_last_7_days: number;
      awaiting_reports: number;
      open_exceptions: number;
    };
    route_control: {
      locked_schedules: number;
      pending_override_requests: number;
      emergency_impact_items: number;
    };
    after_hours_readiness: {
      emergency_capable_shift_count: number;
      holiday_gap_count: number;
      holiday_gaps: unknown[];
    };
    inventory_readiness: {
      blocked: number;
      partial: number;
    };
    regional_pipeline: {
      follow_up_activities: number;
      conference_action_items: number;
      intake_cases: number;
      top_followups: unknown[];
    };
    billing_prevention: {
      previsit_blockers: number;
      review_tasks: number;
      report_delivery_backlog: number;
    };
    home_care_feature_summary: unknown;
    intake_linkage: unknown[];
    conference_follow_ups: {
      pending_tasks: number;
      undelivered_reports: number;
    };
    self_reports: unknown[];
    refill_upcoming: unknown[];
  };
};
