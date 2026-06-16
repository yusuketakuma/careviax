import { expect, test, type Page } from '@playwright/test';
import { attachLocalSession, createInstrumentedPage, openStableRoute } from './helpers/local-auth';
import { apiPathPattern, fulfillJson } from './helpers/route-mocks';
import type { WorkflowDashboardResponse } from '@/types/api/workflow-dashboard';

type WorkflowView = 'phase' | 'realtime' | 'performance';

const WORKFLOW_DATA: WorkflowDashboardResponse['data'] = {
  after_hours_readiness: {
    emergency_capable_shift_count: 0,
    holiday_gap_count: 0,
    holiday_gaps: [],
  },
  billing_prevention: {
    previsit_blockers: 0,
    report_delivery_backlog: 0,
    review_tasks: 0,
  },
  communication_queue: {
    items: [],
    summary: {
      callback_followups: 0,
      delivery_backlog: 0,
      expiring_external_shares: 0,
      open_requests: 0,
      overdue_count: 0,
      pending_count: 0,
      self_reports: 0,
    },
  },
  communication_requests: {
    overdue: 0,
    pending: 0,
  },
  conference_follow_ups: {
    pending_tasks: 0,
    undelivered_reports: 0,
  },
  cycle_status_counts: {
    setting: 1,
  },
  delivery: {
    failures: 0,
  },
  exception_command_center: [],
  facility_visibility: {
    clusters: [],
  },
  home_care_feature_summary: {
    features: [],
    totals: {
      attention: 0,
      blocked: 0,
      monitoring: 0,
      ready: 0,
    },
  },
  inquiry_workbench: [],
  intake_linkage: [
    {
      action_href: '/prescriptions',
      action_label: '処方受付を開く',
      id: 'route_mock_intake',
      patient_name: 'RouteMock 患者',
      title: 'RouteMock 処方受付',
    },
  ],
  inventory_readiness: {
    blocked: 0,
    partial: 0,
  },
  operations_queue: {
    callback_followups: 0,
    geocode_reviews: 0,
    intake_linkages: 1,
    management_plan_reviews: 0,
    preparation_pending: 0,
    self_reports_triage: 0,
    visit_demands: 1,
  },
  outcome_metrics: {
    awaiting_reports: 2,
    completed_last_7_days: 8,
    disrupted_last_7_days: 1,
    open_exceptions: 1,
    urgent_completed_last_7_days: 2,
  },
  patient_risk_queue: {
    high_risk_count: 0,
    items: [],
  },
  refill_upcoming: [],
  regional_pipeline: {
    conference_action_items: 0,
    follow_up_activities: 0,
    intake_cases: 0,
    top_followups: [],
  },
  remediation_guidance: [],
  role_inboxes: {
    buckets: [],
    current_role: 'pharmacist',
  },
  route_control: {
    emergency_impact_items: 1,
    locked_schedules: 3,
    pending_override_requests: 2,
  },
  route_operations: {
    emergency_candidates: 1,
    fallback_assignments: 0,
    locked_confirmed_visits: 3,
    override_pending: 2,
  },
  self_reports: [],
  unified_workbench: [
    {
      action_href: '/schedules/proposals?detail=route_mock_proposal',
      action_label: '候補を確認',
      badges: ['RouteMock'],
      due_at: '2026-06-17T09:00:00.000Z',
      id: 'route_mock_proposal',
      item_type: 'proposal',
      owner_name: 'RouteMock 薬剤師',
      patient_name: 'RouteMock 患者',
      priority: 'urgent',
      queue_label: '訪問候補',
      summary: 'RouteMock の軽量 view smoke',
      title: 'RouteMock 訪問候補',
    },
    {
      action_href: '/dispense',
      action_label: '調剤を開く',
      badges: ['調剤'],
      due_at: null,
      id: 'route_mock_dispensing',
      item_type: 'task',
      owner_name: null,
      patient_name: 'RouteMock 患者',
      priority: 'high',
      queue_label: '調剤',
      summary: 'RouteMock 調剤タスク',
      title: 'RouteMock 調剤',
    },
  ],
  visit_operations: {
    awaiting_reports: 2,
    missing_emergency_contact: 0,
    missing_first_visit_doc: 0,
    missing_management_plan: 0,
    missing_primary_physician: 0,
    missing_visit_consent: 0,
    overdue: 1,
  },
  workload_metrics: {
    pharmacists: [
      {
        callback_followups: 0,
        confirmed_visits: 3,
        facility_clusters: 0,
        pending_tasks: 2,
        pharmacist_id: 'route_mock_pharmacist',
        pharmacist_name: 'RouteMock 薬剤師',
        urgent_items: 1,
      },
    ],
  },
  workflow_exceptions: {
    items: [],
    open: 1,
  },
};

const RUNTIME_PERFORMANCE = {
  data: {
    collected_since: '2026-06-16T00:00:00.000Z',
    routes: [
      {
        average_ms: 120,
        error_count: 0,
        last_seen_at: '2026-06-16T00:00:00.000Z',
        last_status: 200,
        max_ms: 180,
        method: 'GET',
        p50_ms: 110,
        p95_ms: 180,
        request_count: 12,
        route: '/api/dashboard/workflow',
        slow_count: 0,
        slow_rate: 0,
        target_met: true,
      },
    ],
    scope: 'current-process',
    summary: {
      error_requests: 0,
      overall_p50_ms: 110,
      overall_p95_ms: 180,
      route_count: 1,
      routes_over_target: 0,
      slow_request_rate: 0,
      slow_requests: 0,
      total_requests: 12,
    },
    target_ms: 500,
  },
};

test.use({ serviceWorkers: 'block' });

async function installCommonRouteMocks(page: Page) {
  await page.route(apiPathPattern('/api/notifications'), (route) =>
    fulfillJson(route, { data: [] }),
  );
  await page.route(apiPathPattern('/api/dispense-audits'), (route) =>
    fulfillJson(route, { data: { count: 0 } }),
  );
  await page.route(apiPathPattern('/api/handoff-board'), (route) =>
    fulfillJson(route, { data: { count: 0 } }),
  );
}

async function installWorkflowRouteMock(page: Page, requests: URL[]) {
  await page.route(apiPathPattern('/api/dashboard/workflow'), async (route) => {
    requests.push(new URL(route.request().url()));
    await fulfillJson(route, { data: WORKFLOW_DATA });
  });
}

async function installScheduleProposalRouteMocks(page: Page) {
  await page.route(apiPathPattern('/api/visit-schedule-proposals'), (route) =>
    fulfillJson(route, { data: [] }),
  );
  await page.route(apiPathPattern('/api/visit-schedules/day-board'), (route) =>
    fulfillJson(route, { data: [] }),
  );
  await page.route(apiPathPattern('/api/visit-schedules'), (route) =>
    fulfillJson(route, { data: [] }),
  );
  await page.route(apiPathPattern('/api/cases'), (route) => fulfillJson(route, { data: [] }));
  await page.route(apiPathPattern('/api/pharmacists'), (route) => fulfillJson(route, { data: [] }));
  await page.route(apiPathPattern('/api/tasks'), (route) => fulfillJson(route, { data: [] }));
  await page.route(apiPathPattern('/api/visit-preparations/brief-batch'), (route) =>
    fulfillJson(route, { data: [] }),
  );
  await page.route(apiPathPattern('/api/visit-routes'), (route) =>
    fulfillJson(route, { data: [] }),
  );
}

async function installPerformanceRouteMocks(page: Page) {
  await page.route(apiPathPattern('/api/visit-schedules'), (route) =>
    fulfillJson(route, {
      data: [
        {
          assignment_mode: 'primary',
          case_: { patient: { name: 'RouteMock 患者' } },
          confirmed_at: '2026-06-16T00:00:00.000Z',
          id: 'route_mock_schedule',
          override_request: null,
          priority: 'normal',
          scheduled_date: '2026-06-17',
        },
      ],
    }),
  );
  await page.route(apiPathPattern('/api/visit-schedule-proposals'), (route) =>
    fulfillJson(route, {
      data: [
        {
          assignment_mode: 'fallback',
          case_: { patient: { name: 'RouteMock 患者' } },
          id: 'route_mock_proposal',
          patient_contact_status: 'confirmed',
          priority: 'emergency',
          proposal_reason: 'RouteMock / 移動負荷',
          proposal_status: 'confirmed',
          proposed_date: '2026-06-17',
          route_distance_score: 8.2,
          visit_deadline_date: '2026-06-18',
        },
      ],
    }),
  );
  await page.route(apiPathPattern('/api/admin/performance-metrics'), (route) =>
    fulfillJson(route, RUNTIME_PERFORMANCE),
  );
}

function expectWorkflowView(requests: URL[], view: WorkflowView) {
  expect(
    requests.some(
      (url) => url.pathname === '/api/dashboard/workflow' && url.searchParams.get('view') === view,
    ),
  ).toBe(true);
}

test.describe('workflow lightweight dashboard views', () => {
  test.beforeEach(async ({ context }) => {
    await attachLocalSession(context);
  });

  test('schedule proposal phase panel uses the phase workflow view', async ({
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'single chromium smoke covers the route URL contract.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    const workflowRequests: URL[] = [];
    await installCommonRouteMocks(page);
    await installWorkflowRouteMock(page, workflowRequests);
    await installScheduleProposalRouteMocks(page);

    await openStableRoute(page, '/schedules/proposals?workspace=dashboard');

    await expect(page.getByRole('heading', { name: '訪問候補ダッシュボード' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('workflow-phase-panel')).toBeVisible({ timeout: 15_000 });
    expectWorkflowView(workflowRequests, 'phase');
    expect(errors).toEqual([]);
  });

  test('admin realtime uses the realtime workflow view', async ({ context }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'single chromium smoke covers the route URL contract.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    const workflowRequests: URL[] = [];
    await installCommonRouteMocks(page);
    await installWorkflowRouteMock(page, workflowRequests);

    await openStableRoute(page, '/admin/realtime');

    await expect(page.getByRole('heading', { name: 'リアルタイム運用監視' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('ライブワークベンチ')).toBeVisible();
    expectWorkflowView(workflowRequests, 'realtime');
    expect(errors).toEqual([]);
  });

  test('admin performance uses the performance workflow view', async ({ context }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'single chromium smoke covers the route URL contract.',
    );

    const { page, errors } = await createInstrumentedPage(context);
    const workflowRequests: URL[] = [];
    await installCommonRouteMocks(page);
    await installWorkflowRouteMock(page, workflowRequests);
    await installPerformanceRouteMocks(page);

    await openStableRoute(page, '/admin/performance');

    await expect(page.getByRole('heading', { name: '運用パフォーマンス' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('API P95')).toBeVisible();
    expectWorkflowView(workflowRequests, 'performance');
    expect(errors).toEqual([]);
  });
});
