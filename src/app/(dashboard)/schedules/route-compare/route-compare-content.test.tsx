// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { ScheduleDayBoardResponse } from '@/types/schedule-day-board';
import type { VisitRoutePlan } from '@/types/visit-route';
import type { VisitSchedule } from '../day-view.shared';
import { RouteCompareContent } from './route-compare-content';

const syncSearchParamsMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/navigation/use-synced-search-params', () => ({
  useSyncedSearchParams: () => syncSearchParamsMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <p>{description}</p>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

setupDomTestEnv();

type FetchCall = {
  url: string;
  init?: RequestInit;
  body: Record<string, unknown> | null;
};

const fetchCalls: FetchCall[] = [];
let failTimePreferenceRoute = false;
let failAllRouteScenarios = false;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderRouteCompareContent() {
  const queryClient = createQueryClient();
  return {
    queryClient,
    ...render(<RouteCompareContent initialDate="2026-04-09" />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    }),
  };
}

function buildSchedule(overrides: Partial<VisitSchedule>): VisitSchedule {
  return {
    id: 'visit-a',
    case_id: 'case-a',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    carry_items_status: null,
    scheduled_date: '2026-04-09',
    time_window_start: '2026-04-09T14:00:00.000Z',
    time_window_end: '2026-04-09T14:30:00.000Z',
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 2,
    facility_batch_id: null,
    confirmed_at: null,
    case_: {
      patient: {
        id: 'patient-a',
        name: '田中 一郎',
        residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
      },
    },
    site: {
      id: 'site_1',
      name: '本店',
      address: '東京都千代田区2-2-2',
      lat: 35,
      lng: 139,
    },
    vehicle_resource: null,
    preparation: null,
    override_request: null,
    applied_override: null,
    facility_hint: null,
    workload_hint: {
      daily_visit_count: 3,
      urgent_visit_count: 1,
    },
    handoff_hint: null,
    ...overrides,
  };
}

const visitA = buildSchedule({});
const visitB = buildSchedule({
  id: 'visit-b',
  case_id: 'case-b',
  route_order: 1,
  time_window_start: '2026-04-09T10:30:00.000Z',
  time_window_end: '2026-04-09T11:00:00.000Z',
  case_: {
    patient: {
      id: 'patient-b',
      name: '伊藤 キヨ',
      residences: [{ address: '東京都千代田区3-3-3', lat: 35.2, lng: 139.2 }],
    },
  },
});
const confirmedVisit = buildSchedule({
  id: 'visit-confirmed',
  case_id: 'case-confirmed',
  route_order: 1,
  confirmed_at: '2026-04-08T12:00:00.000Z',
  time_window_start: '2026-04-09T09:00:00.000Z',
  time_window_end: '2026-04-09T09:30:00.000Z',
  case_: {
    patient: {
      id: 'patient-confirmed',
      name: '確定 患者',
      residences: [{ address: '東京都千代田区6-6-6', lat: 35.5, lng: 139.5 }],
    },
  },
});
const visitC = buildSchedule({
  id: 'visit-c',
  case_id: 'case-c',
  priority: 'emergency',
  route_order: 3,
  time_window_start: '2026-04-09T15:00:00.000Z',
  time_window_end: '2026-04-09T15:30:00.000Z',
  case_: {
    patient: {
      id: 'patient-c',
      name: '緊急 患者',
      residences: [{ address: '東京都千代田区4-4-4', lat: 35.3, lng: 139.3 }],
    },
  },
});
const facilityVisit = buildSchedule({
  id: 'facility-1',
  case_id: 'case-facility',
  route_order: 4,
  facility_batch_id: 'batch_1',
  time_window_start: '2026-04-09T16:00:00.000Z',
  time_window_end: '2026-04-09T16:30:00.000Z',
  case_: {
    patient: {
      id: 'patient-facility',
      name: '施設 患者',
      residences: [{ address: '東京都千代田区5-5-5', lat: 35.4, lng: 139.4 }],
    },
  },
});

function boardFixture(): ScheduleDayBoardResponse {
  return {
    generated_at: '2026-04-09T00:00:00.000Z',
    date: '2026-04-09',
    staff: [],
    audit_pending_count: 0,
    report_pending_count: 0,
    vehicle_resources: [
      {
        id: 'vehicle_1',
        label: '社用車A',
        site_id: 'site_1',
        vehicle_code: 'CAR-A',
        travel_mode: 'DRIVE',
        available: true,
        max_stops: 6,
        assigned_visit_count: 0,
        remaining_stops: 6,
        recommended: true,
        recommendation_reason: '予備枠 6件',
      },
    ],
    pending_proposals: [],
    pending_proposal_counts: {
      total_count: 0,
      visible_count: 0,
      hidden_count: 0,
      limit: 3,
      hidden_operational_task_count: 0,
    },
    operational_tasks: [],
  };
}

function routePlan(orderedScheduleIds: string[], totalDurationSeconds: number): VisitRoutePlan {
  return {
    status: 'ok',
    note: 'ヒューリスティック順序を表示しています',
    travelMode: 'DRIVE',
    origin: { lat: 35, lng: 139, label: '本店' },
    encodedPath: null,
    orderedScheduleIds,
    totalDistanceMeters: totalDurationSeconds,
    totalDurationSeconds,
    stopSummaries: orderedScheduleIds.map((scheduleId, index) => ({
      scheduleId,
      optimizedOrder: index + 1,
      arrivalOffsetSeconds: (index + 1) * 300,
      distanceFromPreviousMeters: 500,
      durationFromPreviousSeconds: 300,
    })),
  };
}

function scenarioForBody(body: Record<string, unknown> | null) {
  const scheduleIds = body?.schedule_ids;
  const lockedIds = body?.locked_schedule_ids;
  const scheduleIdList = Array.isArray(scheduleIds) ? scheduleIds.map(String) : [];
  const lockedIdList = Array.isArray(lockedIds) ? lockedIds.map(String) : [];
  if (lockedIdList.length === scheduleIdList.length) return 'time_preference';
  if (lockedIdList.length > 0) return 'emergency_slack';
  return 'min_travel';
}

function installFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      fetchCalls.push({ url, init, body });

      if (url.startsWith('/api/visit-schedules?')) {
        return jsonResponse({
          data: [confirmedVisit, visitA, visitB, visitC, facilityVisit],
          hasMore: false,
        });
      }
      if (url.startsWith('/api/visit-schedules/day-board')) {
        return jsonResponse({ data: boardFixture() });
      }
      if (url === '/api/visit-routes') {
        const scenario = scenarioForBody(body);
        if (failAllRouteScenarios) {
          return jsonResponse({ message: '経路計算に失敗しました' }, 500);
        }
        if (scenario === 'time_preference' && failTimePreferenceRoute) {
          return jsonResponse({ message: '経路計算に失敗しました' }, 500);
        }
        if (scenario === 'time_preference') {
          return jsonResponse({
            data: routePlan(['visit-confirmed', 'visit-b', 'visit-a', 'visit-c'], 31 * 60),
          });
        }
        if (scenario === 'emergency_slack') {
          return jsonResponse({
            data: routePlan(['visit-confirmed', 'visit-c', 'visit-b', 'visit-a'], 35 * 60),
          });
        }
        return jsonResponse({
          data: routePlan(['visit-confirmed', 'visit-c', 'visit-a', 'visit-b'], 23 * 60),
        });
      }
      if (url === '/api/visit-schedules/reorder') {
        return jsonResponse({ data: { ok: true } });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }),
  );
}

beforeEach(() => {
  fetchCalls.length = 0;
  failTimePreferenceRoute = false;
  failAllRouteScenarios = false;
  vi.clearAllMocks();
  installFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RouteCompareContent', () => {
  it('computes three scenarios through visit-routes and applies the selected engine order', async () => {
    renderRouteCompareContent();

    expect(await screen.findAllByText(/移動23分/)).not.toHaveLength(0);
    expect(screen.queryByText(/薬局⇔訪問先 16 分/)).toBeNull();

    const routeRequests = fetchCalls.filter((call) => call.url === '/api/visit-routes');
    expect(routeRequests).toHaveLength(3);
    for (const request of routeRequests) {
      expect(request.body?.schedule_ids).toEqual(
        expect.arrayContaining(['visit-confirmed', 'visit-a', 'visit-b', 'visit-c']),
      );
      expect(request.body?.schedule_ids).not.toContain('facility-1');
      expect(request.body?.vehicle_resource_id).toBe('vehicle_1');
      expect(request.body?.travel_mode).toBe('DRIVE');
    }

    const scenarioB = screen.getByLabelText('案B 希望時間優先');
    fireEvent.click(within(scenarioB).getByRole('button', { name: 'この案を使う' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'この案を使う' }),
    );

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    const reorderRequest = fetchCalls.find((call) => call.url === '/api/visit-schedules/reorder');
    expect(reorderRequest?.body).toMatchObject({
      updates: [
        { schedule_id: 'visit-b', route_order: 2 },
        { schedule_id: 'visit-a', route_order: 3 },
        { schedule_id: 'visit-c', route_order: 4 },
        { schedule_id: 'facility-1', route_order: 5 },
      ],
      confirmation_context: {
        source: 'route_compare_adoption',
        date: '2026-04-09',
        target_count: 4,
        route_order_diff_count: 4,
        vehicle_assignment_count: 4,
      },
    });
    expect(reorderRequest?.body?.updates).not.toContainEqual(
      expect.objectContaining({ schedule_id: 'visit-confirmed' }),
    );
  });

  it('keeps confirmed visits out of the adoption payload even when the engine returns them', async () => {
    renderRouteCompareContent();

    expect(await screen.findAllByText(/移動23分/)).not.toHaveLength(0);
    const scenarioA = screen.getByLabelText('案A 移動少なめ');
    fireEvent.click(within(scenarioA).getByRole('button', { name: 'この案を使う' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'この案を使う' }),
    );

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    const reorderRequest = fetchCalls.find((call) => call.url === '/api/visit-schedules/reorder');
    expect(reorderRequest?.body).toMatchObject({
      updates: [
        { schedule_id: 'visit-c', route_order: 2 },
        { schedule_id: 'visit-a', route_order: 3 },
        { schedule_id: 'visit-b', route_order: 4 },
        { schedule_id: 'facility-1', route_order: 5 },
      ],
      confirmation_context: {
        source: 'route_compare_adoption',
        date: '2026-04-09',
        target_count: 4,
        route_order_diff_count: 4,
        vehicle_assignment_count: 4,
      },
    });
    expect(reorderRequest?.body?.updates).not.toContainEqual(
      expect.objectContaining({ schedule_id: 'visit-confirmed' }),
    );
  });

  it('keeps partial route failures visible and disables only the failed scenario', async () => {
    failTimePreferenceRoute = true;
    renderRouteCompareContent();

    expect(await screen.findAllByText(/移動23分/)).not.toHaveLength(0);
    const scenarioB = screen.getByLabelText('案B 希望時間優先');
    expect(within(scenarioB).getByText(/採用不可: 経路計算に失敗しました/)).not.toBeNull();
    expect(
      (within(scenarioB).getByRole('button', { name: 'この案を使う' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText('移動35分 / 午後余力大')).not.toBeNull();
  });

  it('does not render recommended route detail when every route-engine scenario fails', async () => {
    failAllRouteScenarios = true;
    renderRouteCompareContent();

    await waitFor(() =>
      expect(fetchCalls.filter((call) => call.url === '/api/visit-routes')).toHaveLength(3),
    );
    await screen.findAllByText(/採用不可: 経路計算に失敗しました/);

    expect(screen.queryByTestId('route-recommended-detail')).toBeNull();
    expect(screen.queryByText('ルート最適化詳細')).toBeNull();
    for (const label of ['案A 移動少なめ', '案B 希望時間優先', '案C 緊急余力優先']) {
      const scenario = screen.getByLabelText(label);
      expect(within(scenario).getByText(/採用不可: 経路計算に失敗しました/)).not.toBeNull();
      expect(
        (within(scenario).getByRole('button', { name: 'この案を使う' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }
  });
});
