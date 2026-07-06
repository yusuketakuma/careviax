import type { HomeCareFeatureSummary } from '@/types/home-care';

export type WorkflowData = {
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
  communication_requests: { pending: number; overdue: number };
  delivery: { failures: number };
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
    buckets: Array<{
      role: 'pharmacist' | 'clerk' | 'admin';
      label: string;
      open_items: number;
      urgent_items: number;
      communication_items: number;
      action_href: string;
    }>;
  };
  communication_queue: {
    summary: {
      pending_count: number;
      overdue_count: number;
      self_reports: number;
      callback_followups: number;
      inbound_communications: number;
      open_requests: number;
      delivery_backlog: number;
      expiring_external_shares: number;
      unconfirmed_count: number;
      reply_waiting_count: number;
      failed_count: number;
    };
    items: Array<{
      id: string;
      queue_type: string;
      title: string;
      summary: string;
      channel: string;
      status: string;
      priority: 'urgent' | 'high' | 'normal';
      patient_name: string | null;
      due_at: string | null;
      action_href: string;
      action_label: string;
    }>;
    timeline: Array<{
      id: string;
      source_type: 'care_report' | 'tracing_report' | 'communication_request' | 'delivery_record';
      patient_name: string | null;
      title: string;
      summary: string;
      status: string;
      occurred_at: string | null;
      action_href: string;
      action_label: string;
    }>;
    emergency_drafts: Array<{
      id: string;
      patient_id: string;
      template_key: string;
      request_type: string;
      target_name: string | null;
      target_role: string;
      title: string;
      summary: string;
      subject: string;
      content: string;
      action_href: string;
      action_label: string;
    }>;
  };
  patient_risk_queue: {
    high_risk_count: number;
    items: Array<{
      patient_id: string;
      patient_name: string;
      score: number;
      level: 'stable' | 'watch' | 'high';
      reasons: string[];
      unresolved_self_reports: number;
      open_issues: number;
      disrupted_visits_30d: number;
      pending_reports: number;
      open_tasks: number;
      missing_visit_consent: boolean;
      missing_management_plan: boolean;
    }>;
  };
  inquiry_workbench: Array<{
    id: string;
    item_type: 'issue' | 'inquiry';
    inquiry_id: string | null;
    issue_id: string | null;
    line_id: string | null;
    cycle_id: string | null;
    case_id: string | null;
    patient_id: string;
    patient_name: string;
    title: string;
    summary: string;
    reason: string;
    inquiry_to_physician: string;
    proposal_origin: 'post_inquiry' | 'pre_issuance' | null;
    residual_adjustment: boolean | null;
    change_detail: string | null;
    line: {
      id: string;
      drug_name: string;
      dose: string;
      frequency: string;
      days: number;
    } | null;
    request_status: string | null;
    queue_state: string;
    due_at: string | null;
    created_at: string;
    can_create: boolean;
  }>;
  remediation_guidance: Array<{
    id: string;
    title: string;
    description: string;
    severity: 'urgent' | 'high' | 'normal';
    count: number;
    action_href: string;
    action_label: string;
  }>;
  unified_workbench: Array<{
    id: string;
    item_type: 'task' | 'proposal' | 'visit' | 'self_report' | 'aggregate';
    queue_label: string;
    title: string;
    summary: string;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    due_at: string | null;
    action_href: string;
    action_label: string;
    owner_name: string | null;
    patient_name: string | null;
    badges: string[];
  }>;
  facility_visibility: {
    clusters: Array<{
      id: string;
      date: string;
      label: string;
      site_name: string | null;
      pharmacist_name: string | null;
      patient_count: number;
      patient_names: string[];
      route_window: string;
    }>;
  };
  exception_command_center: Array<{
    id: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    patient_name: string | null;
    created_at: string | null;
    action_href: string;
    action_label: string;
  }>;
  workload_metrics: {
    pharmacists: Array<{
      pharmacist_id: string;
      pharmacist_name: string;
      confirmed_visits: number;
      pending_tasks: number;
      urgent_items: number;
      callback_followups: number;
      facility_clusters: number;
    }>;
  };
  route_operations: {
    locked_confirmed_visits: number;
    fallback_assignments: number;
    override_pending: number;
    emergency_candidates: number;
  };
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
    holiday_gaps: Array<{
      id: string;
      date: string;
      name: string;
      site_id: string | null;
    }>;
  };
  inventory_readiness: {
    blocked: number;
    partial: number;
  };
  regional_pipeline: {
    follow_up_activities: number;
    conference_action_items: number;
    intake_cases: number;
    top_followups: Array<{
      id: string;
      title: string;
      partner_name: string | null;
      activity_type: string;
      activity_date: string;
      referrals_generated: number | null;
    }>;
  };
  billing_prevention: {
    previsit_blockers: number;
    review_tasks: number;
    report_delivery_backlog: number;
  };
  home_care_feature_summary: HomeCareFeatureSummary;
  intake_linkage: Array<{
    id: string;
    patient_name: string;
    reason: string;
    due_at: string | null;
    action_href: string;
    action_label: string;
    category: string;
  }>;
  self_reports: Array<{
    id: string;
    patient_name: string;
    reported_by_name: string;
    relation: string | null;
    subject: string;
    category: string;
    requested_callback: boolean;
    preferred_contact_time: string | null;
    status: string;
    created_at: string;
  }>;
  refill_upcoming: Array<{
    id: string;
    cycle_id: string;
    case_id: string | null;
    upcoming_kind: 'refill' | 'split';
    remaining_count: number;
    refill_remaining_count: number;
    split_dispense_total: number | null;
    split_dispense_current: number | null;
    prescribed_date: string;
    refill_next_dispense_date: string | null;
    split_next_dispense_date: string | null;
    next_dispense_date: string | null;
    suggested_start_date: string | null;
    has_existing_route: boolean;
    cycle: {
      patient_id: string;
      case_: { patient: { id: string; name: string } };
    };
  }>;
};

export type InquiryWorkbenchItem = WorkflowData['inquiry_workbench'][number];

export type InquiryEditState = {
  changeDetail: string;
  drugName: string;
  dose: string;
  frequency: string;
  days: string;
  proposalOrigin: 'post_inquiry' | 'pre_issuance';
  residualAdjustment: boolean;
};
