// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/components/features/workflow/stagnation-indicator', () => ({
  StagnationIndicator: () => <div />,
}));

vi.mock('@/components/home-care/home-care-feature-board', () => ({
  HomeCareFeatureBoard: () => <div />,
}));

import { WorkflowDashboardContent } from './workflow-dashboard-content';

setupDomTestEnv();

function buildWorkflowData() {
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
  };
}

describe('WorkflowDashboardContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useRealtimeQueryMock.mockReturnValue({
      data: { data: buildWorkflowData() },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('shows the home context banner and highlights the requested workflow section', () => {
    render(
      <WorkflowDashboardContent initialFocus="communication" initialContext="dashboard_home" />,
    );

    expect(screen.getByTestId('workflow-context-banner')).toBeTruthy();
    expect(
      screen.getByText('ホームから連携・通知まわりにフォーカスして開いています。'),
    ).toBeTruthy();
    expect(screen.getByText('主業務フロー')).toBeTruthy();
    expect(screen.getByTestId('workflow-main-workflow-route')).toBeTruthy();
    expect(screen.getByTestId('workflow-integration-map')).toBeTruthy();
    expect(screen.getByText('訪問記録を報告書へ展開する')).toBeTruthy();
    expect(screen.getByTestId('workflow-communication')).toBeTruthy();
  });

  it('shows an error state instead of an empty workflow dashboard when initial loading fails', () => {
    const refetch = vi.fn();
    useRealtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<WorkflowDashboardContent />);

    expect(
      screen.getByRole('heading', { name: 'ワークフローダッシュボードを表示できません' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    expect(screen.queryByText('主業務フロー')).toBeNull();
    expect(screen.queryByTestId('workflow-communication')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('labels inquiry workbench edit fields without exposing patient or drug names', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: {
        data: {
          ...buildWorkflowData(),
          inquiry_workbench: [
            {
              id: 'inquiry_workbench_1',
              item_type: 'inquiry',
              inquiry_id: 'inquiry_1',
              issue_id: 'issue_1',
              line_id: 'line_1',
              cycle_id: 'cycle_1',
              case_id: 'case_1',
              patient_id: 'patient_1',
              patient_name: '田中太郎',
              title: '処方内容確認',
              summary: '用量の変更確認',
              reason: '用量確認',
              inquiry_to_physician: '主治医',
              proposal_origin: 'post_inquiry',
              residual_adjustment: false,
              change_detail: '',
              line: {
                id: 'line_1',
                drug_name: 'アムロジピン',
                dose: '5mg',
                frequency: '1日1回',
                days: 14,
              },
              request_status: 'pending',
              queue_state: '照会中',
              due_at: null,
              created_at: '2026-06-19T00:00:00.000Z',
              can_create: true,
            },
          ],
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<WorkflowDashboardContent />);

    expect(screen.getByLabelText('疑義照会1件目の薬剤名')).toBeTruthy();
    expect(screen.getByLabelText('疑義照会1件目の用量')).toBeTruthy();
    expect(screen.getByLabelText('疑義照会1件目の用法')).toBeTruthy();
    expect(screen.getByLabelText('疑義照会1件目の投与日数')).toBeTruthy();
    expect(screen.getByLabelText('疑義照会1件目の変更内容メモ')).toBeTruthy();
    expect(screen.queryByLabelText(/田中太郎|アムロジピン/)).toBeNull();
  });
});
