// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const adminPageHeaderPropsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@/components/features/admin/admin-page-header', () => ({
  AdminPageHeader: (props: { supportingContent?: unknown }) => {
    adminPageHeaderPropsMock(props);
    return <header data-testid="admin-page-header" />;
  },
}));

vi.mock('@/components/features/admin/admin-page-shortcut-presets', () => ({
  getAdminPerformanceShortcutLinks: () => [],
}));

vi.mock('@/app/(dashboard)/admin/staff/staff-kpi-panel', () => ({
  StaffKpiPanel: () => <section data-testid="staff-kpi-panel" />,
}));

import PerformancePage from './page';

setupDomTestEnv();

type QueryOption = {
  queryKey: readonly unknown[];
  queryFn?: () => Promise<unknown>;
};

const EXPECTED_WORKFLOW_INVALIDATION = [
  'cycle_transition',
  expect.objectContaining({
    type: 'workflow_refresh',
    source: expect.arrayContaining([
      'medication_cycles_transition',
      'prescription_intakes_create',
      'visit_schedules_update',
      'set_batches_update',
    ]),
  }),
];

const EXPECTED_SCHEDULE_INVALIDATION = [
  expect.objectContaining({
    type: 'workflow_refresh',
    source: expect.arrayContaining([
      'visit_schedules_update',
      'visit_schedule_proposals_create',
      'visit_schedule_proposals_confirm',
      'facility_visit_batches_upsert',
    ]),
  }),
];

describe('PerformancePage polling policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
  });

  it('uses realtime invalidation for workflow metrics and slows runtime polling', () => {
    render(<PerformancePage />);

    expect(adminPageHeaderPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ supportingContent: null }),
    );
    expect(screen.queryByText('最初に見るポイント')).toBeNull();
    expect(screen.queryByText('Operational Performance')).toBeNull();
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-performance-workflow', 'org_1'],
        invalidateOn: EXPECTED_WORKFLOW_INVALIDATION,
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['admin-performance-schedules', 'org_1']),
        invalidateOn: EXPECTED_SCHEDULE_INVALIDATION,
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['admin-performance-proposals', 'org_1']),
        invalidateOn: EXPECTED_SCHEDULE_INVALIDATION,
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-performance-runtime', 'org_1'],
        refetchInterval: 60_000,
      }),
    );
  });

  it('puts actionable performance signals before routine KPI grids', () => {
    render(<PerformancePage />);

    const signalHeading = screen.getByText('今すぐ見る要対応シグナル');
    const workflowKpiHeading = screen.getByText('業務 KPI');
    expect(
      signalHeading.compareDocumentPosition(workflowKpiHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('API latency KPI')).toBeTruthy();
  });

  it('keeps KPI grids dense on mobile and update actions at 44px', () => {
    render(<PerformancePage />);

    expect(screen.getByText('業務 KPI').nextElementSibling?.className).toContain('grid-cols-2');
    expect(screen.getByText('API latency KPI').nextElementSibling?.className).toContain(
      'grid-cols-2',
    );
    expect(screen.getByRole('button', { name: '更新' }).className).toContain('min-h-11');
    expect(screen.getByRole('button', { name: 'Runtime再計測' }).className).toContain('min-h-11');
  });

  it('shows ErrorState (not a false-empty) with retry when the proposals query fails', () => {
    const refetch = vi.fn();
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'admin-performance-proposals') {
        // 訪問候補の取得が失敗 → 空状態ではなく ErrorState + 再読み込み。
        return { data: undefined, isLoading: false, isError: true, refetch };
      }
      return { data: undefined, isLoading: false, refetch };
    });
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });

    render(<PerformancePage />);

    // proposals 失敗は業務 KPI 集計と訪問候補カードの両方を ErrorState 化する。
    expect(screen.getAllByText('サーバーエラーが発生しました').length).toBeGreaterThanOrEqual(1);
    // false-empty（「対象期間の訪問候補はありません」）を出していないこと。
    expect(screen.queryByText('対象期間の訪問候補はありません')).toBeNull();

    const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    expect(refetch).toHaveBeenCalled();
  });

  it('shows ErrorState (not a false-empty) with retry when the runtime metrics query fails', () => {
    const refetch = vi.fn();
    useRealtimeQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
    // ランタイム指標の取得が失敗 → Slow endpoints と latency snapshot を ErrorState 化。
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    render(<PerformancePage />);

    expect(screen.getAllByText('サーバーエラーが発生しました').length).toBeGreaterThanOrEqual(1);
    // false-empty（「サンプル未蓄積」系メッセージ）を出していないこと。
    expect(screen.queryByText('表示できる API latency sample はまだありません')).toBeNull();
    expect(screen.queryByText(/まだ API サンプルがありません/)).toBeNull();
    // 回帰: latency snapshot のサマリ数値(false-zero/未計測)を ErrorState の前に残さないこと。
    expect(screen.queryByText('収集開始')).toBeNull();
    expect(screen.queryByText('サンプル総数')).toBeNull();
    expect(screen.queryByText('記録 route 数')).toBeNull();
    expect(screen.queryByText('5xx 件数')).toBeNull();

    const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
    fireEvent.click(retryButtons[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows payload budget status separately from latency target status', () => {
    useRealtimeQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
    useQueryMock.mockReturnValue({
      isLoading: false,
      refetch: vi.fn(),
      data: {
        data: {
          scope: 'current-process',
          target_ms: 500,
          collected_since: '2026-07-05T00:00:00.000Z',
          summary: {
            route_count: 1,
            total_requests: 12,
            slow_requests: 0,
            error_requests: 0,
            slow_request_rate: 0,
            overall_p50_ms: 80,
            overall_p95_ms: 140,
            overall_p95_payload_bytes: 327_680,
            critical_routes: 1,
            payload_budgeted_routes: 1,
            routes_over_payload_budget: 1,
            routes_with_unconfigured_payload_budget: 0,
            routes_over_target: 0,
          },
          routes: [
            {
              route: '/api/patients/board',
              method: 'GET',
              critical_route: true,
              critical_route_family: 'patients-board',
              request_count: 12,
              error_count: 0,
              slow_count: 0,
              slow_rate: 0,
              average_ms: 90,
              p50_ms: 80,
              p95_ms: 140,
              max_ms: 160,
              payload_sample_count: 12,
              average_payload_bytes: 310_000,
              p95_payload_bytes: 327_680,
              max_payload_bytes: 330_000,
              payload_budget_bytes: 307_200,
              payload_budget_status: 'over_budget',
              payload_budget_met: false,
              payload_budget_over_count: 3,
              last_seen_at: '2026-07-05T00:01:00.000Z',
              last_status: 200,
              last_payload_bytes: 327_680,
              target_met: true,
            },
          ],
        },
      },
    });

    render(<PerformancePage />);

    expect(screen.getByText('latency OK')).toBeTruthy();
    expect(screen.getByText('payload over')).toBeTruthy();
    expect(screen.getByText('/api/patients/board')).toBeTruthy();
    expect(screen.getByText('route family patients-board')).toBeTruthy();
    expect(screen.getByText('payload P95 327,680B')).toBeTruthy();
    expect(screen.getByText('payload budget 307,200B超過')).toBeTruthy();
  });

  it('uses the shared JSON reader for performance read queries', async () => {
    const workflowPayload = {
      data: {
        route_control: {
          locked_schedules: 1,
          pending_override_requests: 0,
          emergency_impact_items: 0,
        },
        outcome_metrics: {
          completed_last_7_days: 3,
          disrupted_last_7_days: 0,
          urgent_completed_last_7_days: 1,
          awaiting_reports: 0,
          open_exceptions: 0,
        },
        workload_metrics: { pharmacists: [] },
      },
    };
    const schedulesPayload = { data: [] };
    const proposalsPayload = { data: [] };
    const runtimePayload = {
      data: {
        scope: 'current-process',
        target_ms: 500,
        collected_since: '2026-07-05T00:00:00.000Z',
        summary: {
          route_count: 1,
          total_requests: 10,
          slow_requests: 0,
          error_requests: 0,
          slow_request_rate: 0,
          overall_p50_ms: 20,
          overall_p95_ms: 50,
          overall_p95_payload_bytes: null,
          critical_routes: 0,
          payload_budgeted_routes: 0,
          routes_over_payload_budget: 0,
          routes_with_unconfigured_payload_budget: 0,
          routes_over_target: 0,
        },
        routes: [],
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toEqual({ 'x-org-id': 'org_1' });
      if (url === '/api/dashboard/workflow?view=performance') {
        return Response.json(workflowPayload);
      }
      if (url.startsWith('/api/visit-schedules?')) {
        expect(url).toContain('limit=200');
        return Response.json(schedulesPayload);
      }
      if (url.startsWith('/api/visit-schedule-proposals?')) {
        return Response.json(proposalsPayload);
      }
      if (url === '/api/admin/performance-metrics?top=6') {
        return Response.json(runtimePayload);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PerformancePage />);

    const realtimeQueries = useRealtimeQueryMock.mock.calls.map(
      ([options]) => options as QueryOption,
    );
    const workflowQuery = realtimeQueries.find(
      (option) => option.queryKey[0] === 'admin-performance-workflow',
    );
    const schedulesQuery = realtimeQueries.find(
      (option) => option.queryKey[0] === 'admin-performance-schedules',
    );
    const proposalsQuery = realtimeQueries.find(
      (option) => option.queryKey[0] === 'admin-performance-proposals',
    );
    const runtimeQuery = useQueryMock.mock.calls.find(
      ([options]) => (options as QueryOption).queryKey[0] === 'admin-performance-runtime',
    )?.[0] as QueryOption | undefined;

    await expect(workflowQuery?.queryFn?.()).resolves.toEqual(workflowPayload);
    await expect(schedulesQuery?.queryFn?.()).resolves.toEqual(schedulesPayload);
    await expect(proposalsQuery?.queryFn?.()).resolves.toEqual(proposalsPayload);
    await expect(runtimeQuery?.queryFn?.()).resolves.toEqual(runtimePayload);

    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/workflow?view=performance', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/visit-schedules\?/), {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/visit-schedule-proposals\?/),
      { headers: { 'x-org-id': 'org_1' } },
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/performance-metrics?top=6', {
      headers: { 'x-org-id': 'org_1' },
    });
  });
});
