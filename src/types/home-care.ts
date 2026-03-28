export type HomeCareFeatureKey =
  | 'emergency_medication_playbook'
  | 'after_hours_rotation_board'
  | 'home_visit_gap_detection'
  | 'previsit_preparation_pack'
  | 'emergency_contact_template'
  | 'adherence_residual_triage'
  | 'medication_safety_prioritizer'
  | 'dosage_form_support'
  | 'caregiver_self_report_intake'
  | 'carry_item_fallback'
  | 'multidisciplinary_share_summary'
  | 'inquiry_workbench'
  | 'facility_batch_tracker'
  | 'consent_plan_huddle'
  | 'refill_auto_revisit'
  | 'callback_sla_monitor'
  | 'change_delta_view'
  | 'billing_blocker_alert'
  | 'regional_resource_map'
  | 'mobile_visit_mode';

export type HomeCareFeatureGroup =
  | 'emergency'
  | 'preparation'
  | 'communication'
  | 'safety'
  | 'continuity';

export type HomeCareFeatureSeverity = 'urgent' | 'high' | 'normal' | 'low';

export type HomeCareFeatureStatus =
  | 'ready'
  | 'monitoring'
  | 'attention'
  | 'blocked';

export type HomeCareFeatureDefinition = {
  key: HomeCareFeatureKey;
  title: string;
  description: string;
  group: HomeCareFeatureGroup;
  action_href: string;
  action_label: string;
};

export type HomeCareFeatureState = HomeCareFeatureDefinition & {
  status: HomeCareFeatureStatus;
  severity: HomeCareFeatureSeverity;
  count: number;
  summary: string;
  evidence: string[];
};

export type HomeCareFeatureSummary = {
  totals: {
    blocked: number;
    attention: number;
    monitoring: number;
    ready: number;
  };
  features: HomeCareFeatureState[];
};
