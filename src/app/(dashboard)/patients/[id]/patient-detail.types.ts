import type { HomeCareFeatureSummary } from '@/types/home-care';
import type { PatientMovementTimelineEvent } from '@/types/patient-movement-timeline';
import type { VisitBrief } from '@/types/visit-brief';
import type { AllergyEntry } from '@/lib/validations/patient-allergy';
import type { JahisSupplementalRecordDbView } from '@/lib/pharmacy/jahis-supplemental-records-view';

export type PatientOverview = {
  id: string;
  name: string;
  name_kana: string;
  birth_date: string;
  gender: string;
  phone: string | null;
  medical_insurance_number: string | null;
  care_insurance_number: string | null;
  billing_support_flag: boolean;
  primary_pharmacist_id: string | null;
  backup_pharmacist_id: string | null;
  primary_staff_id: string | null;
  backup_staff_id: string | null;
  allergy_info: AllergyEntry[] | null;
  notes: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archived_by_name: string | null;
  updated_at: string;
  residences: Array<{
    id: string;
    address: string;
    building_id: string | null;
    facility_id: string | null;
    facility_unit_id: string | null;
    unit_name: string | null;
    is_primary: boolean;
  }>;
  scheduling_preference: {
    preferred_weekdays: number[] | null;
    preferred_time_from: string | null;
    preferred_time_to: string | null;
    phone_contact_from: string | null;
    phone_contact_to: string | null;
    facility_time_from: string | null;
    facility_time_to: string | null;
    family_presence_required: boolean | null;
    visit_buffer_minutes: number | null;
    preferred_contact_name: string | null;
    preferred_contact_phone: string | null;
    visit_before_contact_required: boolean | null;
    first_visit_preferred_date: string | null;
    first_visit_time_slot: string | null;
    first_visit_time_note: string | null;
    parking_available: boolean | null;
    primary_contact_preference: string | null;
    mcs_linked: boolean | null;
    adl_level: string | null;
    dementia_level: string | null;
    swallowing_route: string | null;
    care_level: string | null;
    infection_isolation: boolean;
  } | null;
  conditions: Array<{
    id: string;
    condition_type: 'disease' | 'problem';
    name: string;
    is_primary: boolean;
    is_active: boolean;
    noted_at: string | null;
    notes: string | null;
  }>;
  contacts: Array<{
    id: string;
    relation:
      | 'self'
      | 'spouse'
      | 'child'
      | 'parent'
      | 'sibling'
      | 'care_manager'
      | 'physician'
      | 'nurse'
      | 'facility_staff'
      | 'other';
    name: string;
    phone: string | null;
    email: string | null;
    fax: string | null;
    organization_name: string | null;
    department: string | null;
    address: string | null;
    is_primary: boolean;
    is_emergency_contact: boolean;
    notes: string | null;
  }>;
  cases: Array<{
    id: string;
    display_id?: string | null;
    status: string;
    primary_pharmacist_id: string | null;
    backup_pharmacist_id: string | null;
    referral_source: string | null;
    referral_date: string | null;
    start_date: string | null;
    end_date: string | null;
    end_reason: string | null;
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
    time_window_start: string | null;
    confirmed_at: string | null;
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
  foundation: {
    summary: {
      status: 'ready' | 'needs_confirmation' | 'missing';
      label: string;
      items: string[];
    };
    items: Array<{
      key: string;
      label: string;
      status: 'ready' | 'needs_confirmation' | 'missing';
      detail: string;
      action_href: string;
      action_label: string;
      meta?: {
        updated_at: string;
        updated_by_name: string | null;
        source: string;
        confirmed_at: string | null;
        confirmed_by_name: string | null;
        confirmation_status: 'confirmed' | 'unconfirmed' | 'stale';
        confirmation_detail: string;
        stale: boolean;
      } | null;
    }>;
    changes_since_last_visit: Array<{
      id: string;
      category: string;
      field_label: string | null;
      field_key: string;
      source: string;
      updated_by_name: string | null;
      created_at: string;
    }>;
    latest_labs: Array<{
      analyte_code: string;
      value_label: string;
      measured_at: string;
      stale: boolean;
      abnormal: boolean;
    }>;
    insurances: Array<{
      insurance_type: string;
      status_label: string;
      period_label: string;
      copay_label: string | null;
      expires_soon: boolean;
    }>;
    archive: {
      archived: boolean;
      archived_at: string | null;
      archived_by_name: string | null;
    };
  };
  jahis_supplemental_records: JahisSupplementalRecordDbView[];
  workspace: PatientWorkspace | null;
  privacy: {
    sensitive_fields_masked: boolean;
    address_fields_masked: boolean;
    can_view_detail: boolean;
  };
};

/** p0_08 カード詳細ワークスペース: 進行中サイクルの工程集約 */
export type PatientWorkspaceMedicationChange = {
  change_type: 'added' | 'removed' | 'dose_changed' | 'frequency_changed' | 'days_changed';
  drug_name: string;
  drug_code: string | null;
  frequency: string | null;
  days: number | null;
};

/** 06_card セーフティボード(どの工程でも常時表示)用の安全情報集約 */
export type PatientWorkspaceSafety = {
  /** 例: セフェム系(2019) */
  allergy: string | null;
  /** 例: eGFR 38(6/1) */
  renal: string | null;
  /** 現行処方行の packaging_instruction_tags 集約(narcotic / cold_storage / unit_dose 等) */
  handling_tags: string[];
  /** 嚥下・投与経路(scheduling_preference.swallowing_route) */
  swallowing: string | null;
  /** PatientCondition(problem)由来の注意。例: ふらつき(6/5〜経過観察) */
  cautions: string[];
};

/** 06_card「今回の処方」テーブルの 1 行(現行 intake の処方明細) */
export type PatientWorkspacePrescriptionLine = {
  id: string;
  drug_name: string;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  packaging_instruction_tags: string[];
};

/** 06_card「直近の動き」の 1 行(工程遷移 / 疑義照会 / 処方取込の時系列) */
export type PatientWorkspaceActivity = {
  id: string;
  type: 'transition' | 'inquiry' | 'intake';
  label: string;
  actor: string | null;
  at: string;
  href: string;
};

/** 06_card「このカードに紐づく今日」の 1 行(期限・順序つきタスク) */
export type PatientWorkspaceTodayTask = {
  id: string;
  /** deadline=赤(期限つき) / waiting=灰(順序待ち) / scheduled=緑(時刻確定) */
  tone: 'deadline' | 'waiting' | 'scheduled';
  /** 例: 期限 12:00 / 監査後 / 14:00 */
  time_label: string;
  label: string;
  href: string;
  /** 例: 監査へ / セットへ / 訪問へ */
  action_label: string;
  /** 次にやることボタンの期限内包表示用(HH:mm) */
  due_time: string | null;
};

export type PatientWorkspace = {
  cycle_id: string;
  overall_status: string;
  exception_status: string | null;
  action_context: {
    patient_id: string;
    prescription_intake_id: string | null;
    visit_schedule_id: string | null;
    visit_record_id: string | null;
    report_id: string | null;
  };
  /** 現行 intake(RX 番号の生成元)。formatPrescriptionCardNumber(id, prescribed_date, 'rx_year') */
  current_intake: {
    id: string;
    prescribed_date: string;
    /** 定期/臨時(regular | emergency)。p1_02 カード種別ラベルの導出に使う */
    prescription_category: string;
  } | null;
  safety: PatientWorkspaceSafety;
  prescription_lines: PatientWorkspacePrescriptionLine[];
  recent_activities: PatientWorkspaceActivity[];
  today_tasks: PatientWorkspaceTodayTask[];
  open_exceptions: Array<{
    id: string;
    exception_type: string;
    description: string;
    severity: 'critical' | 'warning';
    created_at: string | null;
  }>;
  medication_changes: PatientWorkspaceMedicationChange[];
  previous_medication: { start: string | null; end: string | null } | null;
  current_medication: { start: string | null; end: string | null } | null;
  set_plan: {
    id: string;
    set_method: string;
    notes: string | null;
    target_period_start: string;
    target_period_end: string;
    processing: {
      unit_dose: boolean;
      separate_pack: boolean;
      crushed: boolean;
    };
  } | null;
  prescription_document_url: string | null;
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
      effective_revision_code: string | null;
      site_config_status: string | null;
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
      effective_revision_code: string | null;
      site_config_status: string | null;
    }>;
  };
};

export type PatientDocumentsSnapshot = {
  patient: {
    id: string;
    name: string;
    name_kana: string;
  };
  print_readiness: {
    overall_status: 'ready' | 'warning' | 'blocked';
    missing_required_count: number;
    warning_count: number;
    template_versions: Array<{
      document_type: string;
      label: string;
      template_id: string | null;
      template_name: string | null;
      template_version: string | null;
      effective_from: string | null;
      effective_to: string | null;
    }>;
    checks: Array<{
      key: string;
      label: string;
      completed: boolean;
      severity: 'required' | 'warning';
      description: string;
      action_href: string;
      action_label: string;
    }>;
  };
  document_statuses: Array<{
    document_type: string;
    label: string;
    status:
      | 'not_created'
      | 'created'
      | 'printed'
      | 'recovered'
      | 'image_saved'
      | 'replaced'
      | 'invalidated';
    status_label: string;
    template_name: string | null;
    template_version: string | null;
    storage_location: string | null;
    latest_action_at: string | null;
    latest_printed_at: string | null;
    latest_print_batch_id: string | null;
    latest_document_id: string | null;
    has_file: boolean;
    delivered_at: string | null;
    alerts: string[];
  }>;
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
    history: Array<{
      id: string;
      action: string;
      document_type: string | null;
      template_name: string | null;
      template_version: string | null;
      print_batch_id?: string | null;
      storage_location: string | null;
      contract_date: string | null;
      explanation_date: string | null;
      explanation_staff_name: string | null;
      signer_type: string | null;
      signer_name: string | null;
      signer_relationship: string | null;
      reason: string | null;
      note: string | null;
      actor_id: string;
      created_at: string;
    }>;
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
    | 'conference_note'
    | 'billing_candidate'
    | 'operation_history'
    | 'self_report'
    | 'communication'
    | 'external_share';
  category: 'visit' | 'prescription' | 'billing' | 'document' | 'communication';
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
  movement_events?: PatientMovementTimelineEvent[];
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
  /**
   * Surfaced when one or more timeline sources degrade (per-source query
   * failure / op_history fail-soft / actor-name fail-soft). Additive: omitted
   * when every source succeeded. `source` is the failing source key.
   */
  partial_failures?: { source: string; message: string }[];
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
      | 'patient_profile'
      | 'primary_residence'
      | 'insurance'
      | 'visit_preferences'
      | 'care_team_recipients'
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

export type PatientWorkflowPreviewSnapshot = {
  visit_preparation: {
    onboarding_readiness: {
      consent_obtained: boolean;
      emergency_contact_set: boolean;
      primary_physician_set: boolean;
      management_plan_approved: boolean;
    };
    scheduling_preview: {
      preferred_weekdays: number[];
      preferred_time_from: string | null;
      preferred_time_to: string | null;
      phone_contact_from: string | null;
      phone_contact_to: string | null;
      facility_time_from: string | null;
      facility_time_to: string | null;
      family_presence_required: boolean;
      visit_buffer_minutes: number | null;
      preferred_contact_name: string | null;
      preferred_contact_phone: string | null;
      visit_before_contact_required: boolean;
      first_visit_preferred_date: string | null;
      first_visit_time_slot: string | null;
      first_visit_time_note: string | null;
      parking_available: boolean | null;
      primary_contact_preference: string | null;
      mcs_linked: boolean;
    };
    baseline_context: {
      primary_disease: string | null;
      care_level: string | null;
      adl_level: string | null;
      dementia_level: string | null;
      money_management: string | null;
      family_key_person: string | null;
      medication_support_methods: string[];
      special_medical_procedures: string[];
      infection_isolation: string | null;
      narcotics_base: boolean | null;
      narcotics_rescue: boolean | null;
      residual_medication_status: string | null;
    };
    latest_labs: Array<{
      analyte_code: string;
      measured_at: string;
      value_numeric: number | null;
      unit: string | null;
      abnormal_flag: string | null;
    }>;
    blockers: string[];
  };
  report_targets: Array<{
    key: 'physician_report' | 'care_manager_report' | 'nurse_share' | 'mcs';
    label: string;
    available: boolean;
    source: 'care_team' | 'requester' | 'intake' | 'patient_setting' | 'missing';
    recipient_name: string | null;
    recipient_organization: string | null;
    contact: string | null;
    status?: string | null;
  }>;
  communication_priority: {
    preferred_contact_method: string | null;
    effective_channel: string;
    visit_before_contact_required: boolean;
    pharmacy_decision_due_date: string | null;
    targets: Array<{
      key: 'family' | 'facility' | 'nurse' | 'care_manager' | 'mcs';
      recipientRole: string;
      recipientName: string;
      contact: string | null;
      priority_order: number;
    }>;
    warnings: string[];
  };
};
