import { describe, expect, it } from 'vitest';
import { buildWorkflowPhaseAccess } from './use-workflow-phase-access';
import type { WorkflowDashboardResponse } from '@/types/api/workflow-dashboard';

function createWorkflowPayload(
  overrides?: Partial<WorkflowDashboardResponse['data']>
): WorkflowDashboardResponse['data'] {
  return {
    cycle_status_counts: {},
    workflow_exceptions: { open: 0, items: [] },
    communication_requests: { pending: 0, overdue: 0 },
    delivery: { failures: 0 },
    visit_operations: {
      overdue: 0,
      awaiting_reports: 0,
      missing_visit_consent: 0,
      missing_management_plan: 0,
      missing_first_visit_doc: 0,
      missing_emergency_contact: 0,
      missing_primary_physician: 0,
    },
    operations_queue: {
      visit_demands: 0,
      callback_followups: 0,
      management_plan_reviews: 0,
      preparation_pending: 0,
      geocode_reviews: 0,
      intake_linkages: 0,
      self_reports_triage: 0,
    },
    role_inboxes: { current_role: 'admin', buckets: [] },
    communication_queue: {},
    patient_risk_queue: { high_risk_count: 0, items: [] },
    inquiry_workbench: [],
    remediation_guidance: [],
    unified_workbench: [],
    facility_visibility: { clusters: [] },
    exception_command_center: [],
    workload_metrics: { pharmacists: [] },
    route_operations: {
      locked_confirmed_visits: 0,
      fallback_assignments: 0,
      override_pending: 0,
      emergency_candidates: 0,
    },
    outcome_metrics: {
      completed_last_7_days: 0,
      disrupted_last_7_days: 0,
      urgent_completed_last_7_days: 0,
      awaiting_reports: 0,
      open_exceptions: 0,
    },
    route_control: {
      locked_schedules: 0,
      pending_override_requests: 0,
      emergency_impact_items: 0,
    },
    after_hours_readiness: {
      emergency_capable_shift_count: 0,
      holiday_gap_count: 0,
      holiday_gaps: [],
    },
    inventory_readiness: { blocked: 0, partial: 0 },
    regional_pipeline: {
      follow_up_activities: 0,
      conference_action_items: 0,
      intake_cases: 0,
      top_followups: [],
    },
    billing_prevention: {
      previsit_blockers: 0,
      review_tasks: 0,
      report_delivery_backlog: 0,
    },
    home_care_feature_summary: null,
    intake_linkage: [],
    conference_follow_ups: {
      pending_tasks: 0,
      undelivered_reports: 0,
    },
    self_reports: [],
    refill_upcoming: [],
    ...overrides,
  };
}

describe('buildWorkflowPhaseAccess', () => {
  it('falls back to cycle status counts for medication-set access when workbench items are absent', () => {
    const phaseAccess = buildWorkflowPhaseAccess(
      createWorkflowPayload({
        cycle_status_counts: {
          setting: 2,
          set_audited: 1,
        },
      })
    );

    expect(phaseAccess.medication_sets.pending_count).toBe(3);
    expect(phaseAccess.medication_sets.summary).toBe('セット 2件 / セット監査 1件');
    expect(phaseAccess.medication_sets.next_action).toEqual({
      href: '/medication-sets',
      label: 'セット監査を確認',
    });
  });
});
