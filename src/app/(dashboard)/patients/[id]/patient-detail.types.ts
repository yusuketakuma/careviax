import type { HomeCareFeatureSummary } from '@/types/home-care';
import type { VisitBrief } from '@/types/visit-brief';
import type { AllergyEntry } from '@/lib/validations/patient-allergy';

export type PatientOverview = {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  gender: string;
  phone: string | null;
  medical_insurance_number: string | null;
  care_insurance_number: string | null;
  allergy_info: AllergyEntry[] | null;
  notes: string | null;
  archived_at: string | null;
  residences: Array<{
    id: string;
    address: string;
    building_id: string | null;
    facility_id: string | null;
    unit_name: string | null;
    is_primary: boolean;
  }>;
  conditions: Array<{
    id: string;
    condition_type: 'disease' | 'problem';
    name: string;
    is_primary: boolean;
    is_active: boolean;
    noted_at: string | null;
    notes: string | null;
  }>;
  cases: Array<{
    id: string;
    status: string;
    primary_pharmacist_id: string | null;
    referral_source: string | null;
    referral_date: string | null;
    start_date: string | null;
    end_date: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
    required_visit_support: Record<string, unknown> | null;
    care_team_links: Array<{
      id: string;
      external_professional_id?: string | null;
      role: string;
      name: string;
      organization_name: string | null;
      department: string | null;
      phone: string | null;
      email: string | null;
      fax: string | null;
      address: string | null;
      is_primary: boolean;
      notes: string | null;
    }>;
  }>;
  visit_schedules: Array<{
    id: string;
    scheduled_date: string;
    schedule_status: string;
    visit_record: {
      id: string;
      outcome_status: string;
    } | null;
  }>;
  summary_metrics: {
    open_tasks_count: number;
  };
  risk_summary: {
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
  } | null;
  visit_brief: VisitBrief;
  lab_summary: Array<{
    analyte_code: string;
    value_numeric: number | null;
    measured_at: string;
    unit: string | null;
    abnormal_flag: string | null;
  }>;
  privacy: {
    sensitive_fields_masked: boolean;
    address_fields_masked: boolean;
    can_view_detail: boolean;
  };
};

export type PatientVisitsSnapshot = {
  monthly_visit_count: number;
  visit_schedules: Array<{
    id: string;
    scheduled_date: string;
    schedule_status: string;
    priority: string;
    confirmed_at: string | null;
    route_order: number | null;
    visit_record: {
      id: string;
      outcome_status: string;
    } | null;
  }>;
  visit_records: Array<{
    id: string;
    schedule_id: string | null;
    visit_date: string | null;
    outcome_status: string;
    next_visit_suggestion_date: string | null;
    cancellation_reason: string | null;
    postpone_reason: string | null;
    revisit_reason: string | null;
    created_at: string;
  }>;
  home_care_feature_summary: HomeCareFeatureSummary;
};

export type PatientCommunicationsSnapshot = {
  communication_queue: {
    summary: {
      pending_count: number;
      overdue_count: number;
      self_reports: number;
      callback_followups: number;
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
  open_tasks: Array<{
    id: string;
    task_type: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    sla_due_at: string | null;
    created_at: string;
  }>;
  medication_issues: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    category: string | null;
    identified_at: string;
  }>;
  billing_summary: {
    claimable_count: number;
    blocked_count: number;
    evidence: Array<{
      id: string;
      billing_month: string | null;
      claimable: boolean;
      exclusion_reason: string | null;
      validation_notes: string | null;
      blockers: Array<{
        key: string;
        reason: string;
        action_href: string;
        action_label: string;
        severity: 'urgent' | 'high' | 'normal';
      }>;
    }>;
    candidates: Array<{
      id: string;
      billing_month: string;
      billing_code: string;
      billing_name: string;
      points: number | null;
      status: string;
      exclusion_reason: string | null;
    }>;
  };
};

export type PatientDocumentsSnapshot = {
  first_visit_documents: Array<{
    id: string;
    case_id: string;
    emergency_contacts: Array<{
      id?: string;
      name: string;
      relation: string | null;
      phone: string | null;
      email: string | null;
      fax: string | null;
      organization_name: string | null;
      department: string | null;
      is_primary: boolean;
      is_emergency_contact: boolean;
    }>;
    document_url: string | null;
    delivered_at: string | null;
    delivered_to: string | null;
    created_at: string;
    updated_at: string;
  }>;
};

export type PatientTimelineEvent = {
  id: string;
  event_type:
    | 'visit_schedule'
    | 'visit_record'
    | 'prescription_intake'
    | 'dispense_result'
    | 'inquiry'
    | 'care_report'
    | 'delivery_record'
    | 'management_plan'
    | 'first_visit_document'
    | 'communication'
    | 'external_share';
  category: 'visit' | 'prescription' | 'document' | 'communication';
  occurred_at: string;
  title: string;
  summary: string | null;
  href: string;
  action_label: string;
  status: string | null;
  status_label: string | null;
  actor_name: string | null;
  metadata: string[];
};

export type PatientTimelineSnapshot = {
  timeline_events: PatientTimelineEvent[];
  self_reports: Array<{
    id: string;
    subject: string;
    category: string;
    content: string;
    relation: string | null;
    status: string;
    reported_by_name: string;
    requested_callback: boolean;
    preferred_contact_time: string | null;
    created_at: string;
  }>;
};

export type PatientReadinessSnapshot = {
  applicable: boolean;
  overall_status: 'ready' | 'action_required' | 'not_started';
  completed_count: number;
  total_count: number;
  current_case: {
    id: string;
    status: string;
  } | null;
  items: Array<{
    key:
      | 'visit_consent'
      | 'emergency_contact'
      | 'primary_physician'
      | 'management_plan'
      | 'prescription_intake'
      | 'first_visit_document';
    label: string;
    completed: boolean;
    description: string;
    action_href: string;
    action_label: string;
    severity: 'normal' | 'high';
  }>;
};
