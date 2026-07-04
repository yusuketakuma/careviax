// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { WorkflowDashboardView } from './workflow-dashboard-view';
import type { InquiryEditState, WorkflowData } from './workflow-dashboard.types';

vi.mock('@/components/features/workflow/stagnation-indicator', () => ({
  StagnationIndicator: () => <div />,
}));

vi.mock('@/components/home-care/home-care-feature-board', () => ({
  HomeCareFeatureBoard: () => <div />,
}));

vi.mock('@/components/features/workflow/workflow-integration-map', () => ({
  WorkflowIntegrationMap: () => <div />,
}));

vi.mock('@/components/features/workflow/main-workflow-route', () => ({
  MainWorkflowRoute: () => <div />,
}));

setupDomTestEnv();

/**
 * W3-E2「継続調剤 - 次回対応」DataTable の characterization test。
 * view 内の `workflow?.foo.bar` は `foo` が undefined のときに `.bar` で例外になるため、
 * 参照される最上位フィールドはすべて埋めておく
 * (buildWorkflowData と同型の最小構成、参照値は 0 / 空配列)。
 */
function buildWorkflowDataBase(): WorkflowData {
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
    role_inboxes: { current_role: 'pharmacist', buckets: [] },
    communication_queue: {
      summary: {
        pending_count: 0,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
        unconfirmed_count: 0,
        reply_waiting_count: 0,
        failed_count: 0,
      },
      items: [],
      timeline: [],
      emergency_drafts: [],
    },
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
    inventory_readiness: {
      blocked: 0,
      partial: 0,
    },
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
    home_care_feature_summary: {
      totals: { blocked: 0, attention: 0, monitoring: 0, ready: 0 },
      features: [],
    },
    intake_linkage: [],
    self_reports: [],
    refill_upcoming: [],
  } as unknown as WorkflowData;
}

function buildProps(refillUpcoming: WorkflowData['refill_upcoming']) {
  const workflow = { ...buildWorkflowDataBase(), refill_upcoming: refillUpcoming };

  return {
    workflow,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    getInquiryEditState: (): InquiryEditState => ({
      changeDetail: '',
      drugName: '',
      dose: '',
      frequency: '',
      days: '',
      proposalOrigin: 'post_inquiry',
      residualAdjustment: false,
    }),
    updateInquiryEditState: vi.fn(),
    buildInquiryResolutionDetail: () => '',
    createEmergencyDraftMutation: { mutate: vi.fn(), isPending: false },
    createInquiryMutation: { mutate: vi.fn(), isPending: false },
    resolveInquiryMutation: { mutate: vi.fn(), isPending: false },
    generateRefillProposalMutation: { mutate: vi.fn(), isPending: false },
  };
}

describe('WorkflowDashboardView - 継続調剤 次回対応テーブル', () => {
  it('shows the empty message when there is no upcoming refill/split item', () => {
    render(<WorkflowDashboardView {...buildProps([])} />);

    expect(screen.getByText('継続調剤の予定はありません')).toBeTruthy();
  });

  it('renders refill and split rows with their kind badges, dispense date, and action state', () => {
    const refillUpcoming: WorkflowData['refill_upcoming'] = [
      {
        id: 'refill_upcoming_1',
        cycle_id: 'cycle_1',
        case_id: 'case_1',
        upcoming_kind: 'refill',
        remaining_count: 2,
        refill_remaining_count: 2,
        split_dispense_total: null,
        split_dispense_current: null,
        prescribed_date: '2026-06-01',
        refill_next_dispense_date: '2026-06-24',
        split_next_dispense_date: null,
        next_dispense_date: '2026-06-24',
        suggested_start_date: '2026-06-24',
        has_existing_route: false,
        cycle: {
          patient_id: 'patient_1',
          case_: { patient: { id: 'patient_1', name: '佐藤花子' } },
        },
      },
      {
        id: 'refill_upcoming_2',
        cycle_id: 'cycle_2',
        case_id: 'case_2',
        upcoming_kind: 'split',
        remaining_count: 0,
        refill_remaining_count: 0,
        split_dispense_total: 3,
        split_dispense_current: 2,
        prescribed_date: '2026-06-05',
        refill_next_dispense_date: null,
        split_next_dispense_date: null,
        next_dispense_date: null,
        suggested_start_date: null,
        has_existing_route: true,
        cycle: {
          patient_id: 'patient_2',
          case_: { patient: { id: 'patient_2', name: '鈴木一郎' } },
        },
      },
    ];

    render(<WorkflowDashboardView {...buildProps(refillUpcoming)} />);

    // DataTable renders a desktop table and a mobile card list at the same time in
    // jsdom, so each cell's content matches twice; assert presence via getAllBy*.
    // Row 1: refill kind badge + remaining count + generate button (no existing route)
    expect(screen.getAllByText('佐藤花子').length).toBeGreaterThan(0);
    expect(screen.getAllByText('リフィル残2回').length).toBeGreaterThan(0);
    expect(screen.getAllByText('薬局保管').length).toBeGreaterThan(0);
    expect(screen.getAllByText('6/24', { exact: false }).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', { name: 'リフィル1件目の再訪候補を生成' }).length,
    ).toBeGreaterThan(0);

    // Row 2: split kind badge + existing-route badge (no generate button)
    expect(screen.getAllByText('鈴木一郎').length).toBeGreaterThan(0);
    expect(screen.getAllByText('分割 2/3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('既存導線あり').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '分割調剤2件目の再訪候補を生成' })).toBeNull();

    // Patient names never leak into the accessible name of the generate button.
    expect(screen.queryByRole('button', { name: /佐藤花子|鈴木一郎/ })).toBeNull();
  });

  it('disables the generate button while the mutation is pending', () => {
    const props = buildProps([
      {
        id: 'refill_upcoming_3',
        cycle_id: 'cycle_3',
        case_id: 'case_3',
        upcoming_kind: 'refill',
        remaining_count: 1,
        refill_remaining_count: 1,
        split_dispense_total: null,
        split_dispense_current: null,
        prescribed_date: '2026-06-10',
        refill_next_dispense_date: null,
        split_next_dispense_date: null,
        next_dispense_date: null,
        suggested_start_date: null,
        has_existing_route: false,
        cycle: {
          patient_id: 'patient_3',
          case_: { patient: { id: 'patient_3', name: '高橋次郎' } },
        },
      },
    ]);
    props.generateRefillProposalMutation.isPending = true;

    render(<WorkflowDashboardView {...props} />);

    const buttons = screen.getAllByRole('button', { name: 'リフィル1件目の再訪候補を生成' });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toHaveProperty('disabled', true);
    }
  });
});
