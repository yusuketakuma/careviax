// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { VisitRoutePlan } from '@/types/visit-route';
import type { VisitSchedule } from '../day-view.shared';
import { buildEmergencyRouteApplyPlan, EmergencyRouteContent } from './emergency-route-content';

const syncSearchParamsMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/navigation/use-synced-search-params', () => ({
  useSyncedSearchParams: () => syncSearchParamsMock,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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
    requiredConfirmText,
    onConfirm,
  }: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    requiredConfirmText?: string;
    onConfirm: () => void;
  }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <p>{description}</p>
        {requiredConfirmText ? <p>確認入力: {requiredConfirmText}</p> : null}
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));

setupDomTestEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderEmergencyRouteContent() {
  const queryClient = createQueryClient();
  return {
    queryClient,
    ...render(<EmergencyRouteContent initialDate="2026-04-09" />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    }),
  };
}

function buildSchedule(overrides: Partial<VisitSchedule>): VisitSchedule {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    carry_items_status: null,
    scheduled_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    facility_batch_id: null,
    confirmed_at: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '患者A',
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
    vehicle_resource: {
      id: 'vehicle_1',
      label: '社用車A',
      travel_mode: 'DRIVE',
      max_stops: 6,
      max_route_duration_minutes: 180,
    },
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

const confirmedFirst = buildSchedule({
  id: 'confirmed_1',
  case_id: 'case_confirmed_1',
  route_order: 1,
  confirmed_at: '2026-04-08T12:00:00.000Z',
  case_: {
    patient: {
      id: 'patient_confirmed_1',
      name: '患者A',
      residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
    },
  },
});

const emergencySchedule = buildSchedule({
  id: 'emergency',
  case_id: 'case_emergency',
  priority: 'emergency',
  route_order: 2,
  confirmed_at: null,
  time_window_start: '2026-04-09T10:00:00.000Z',
  time_window_end: '2026-04-09T11:00:00.000Z',
  case_: {
    patient: {
      id: 'patient_emergency',
      name: '緊急患者',
      residences: [{ address: '東京都千代田区3-3-3', lat: 35.2, lng: 139.2 }],
    },
  },
});

const confirmedTail = buildSchedule({
  id: 'confirmed_tail',
  case_id: 'case_confirmed_tail',
  route_order: 3,
  confirmed_at: '2026-04-08T13:00:00.000Z',
  time_window_start: '2026-04-09T11:00:00.000Z',
  time_window_end: '2026-04-09T12:00:00.000Z',
  case_: {
    patient: {
      id: 'patient_confirmed_tail',
      name: '患者B',
      residences: [{ address: '東京都千代田区4-4-4', lat: 35.3, lng: 139.3 }],
    },
  },
});

const facilityBatchSchedule = buildSchedule({
  id: 'facility_batch',
  case_id: 'case_facility',
  route_order: 4,
  facility_batch_id: 'batch_1',
  confirmed_at: null,
});

function routePlan(
  orderedScheduleIds: string[],
  totalDurationSeconds: number,
  note: string | null = null,
): VisitRoutePlan {
  return {
    status: 'ok',
    note,
    travelMode: 'DRIVE',
    origin: { lat: 35, lng: 139, label: '本店' },
    encodedPath: 'encoded',
    orderedScheduleIds,
    totalDistanceMeters: 1200,
    totalDurationSeconds,
    stopSummaries: orderedScheduleIds.map((scheduleId, index) => ({
      scheduleId,
      optimizedOrder: index + 1,
      arrivalOffsetSeconds: (index + 1) * 300,
      distanceFromPreviousMeters: 400,
      durationFromPreviousSeconds: 300,
    })),
  };
}

function setupFetchMock() {
  const routeBodies: unknown[] = [];
  const reorderBodies: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/visit-schedules?')) {
      return Response.json({
        data: [confirmedFirst, emergencySchedule, confirmedTail, facilityBatchSchedule],
        hasMore: false,
      });
    }

    if (url === '/api/visit-routes') {
      const body = JSON.parse(String(init?.body));
      routeBodies.push(body);
      const scheduleIds = body.schedule_ids as string[];
      if (scheduleIds.length === 2) {
        return Response.json({
          data: routePlan(['confirmed_1', 'confirmed_tail'], 600),
        });
      }
      if (Array.isArray(body.locked_schedule_ids) && body.locked_schedule_ids.length === 2) {
        return Response.json({
          data: routePlan(['confirmed_1', 'emergency', 'confirmed_tail'], 1200),
        });
      }
      return Response.json({
        data: routePlan(['confirmed_1', 'confirmed_tail', 'emergency'], 900, '案2の計算完了'),
      });
    }

    if (url === '/api/visit-schedules/reorder') {
      reorderBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ data: { ok: true } });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, routeBodies, reorderBodies };
}

describe('EmergencyRouteContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recalculates baseline, plan1, and plan2 with confirmed visits locked correctly', async () => {
    const { routeBodies } = setupFetchMock();
    renderEmergencyRouteContent();

    fireEvent.click(await screen.findByRole('button', { name: 'ルートを再計算' }));

    await waitFor(() => expect(routeBodies).toHaveLength(3));
    expect(routeBodies[0]).toMatchObject({
      schedule_ids: ['confirmed_1', 'confirmed_tail'],
    });
    expect(routeBodies[0]).not.toHaveProperty('locked_schedule_ids');
    expect(routeBodies[1]).toMatchObject({
      schedule_ids: ['confirmed_1', 'emergency', 'confirmed_tail'],
      locked_schedule_ids: ['confirmed_1', 'confirmed_tail'],
    });
    expect(routeBodies[2]).toMatchObject({
      schedule_ids: ['confirmed_1', 'emergency', 'confirmed_tail'],
      locked_schedule_ids: ['confirmed_1'],
    });
    expect(screen.getByTestId('emergency-route-scenario-1').textContent).toContain('移動 +10分');
    expect(screen.getByTestId('emergency-route-scenario-2').textContent).toContain('移動 +5分');
  });

  it('applies the selected plan2 route order without mutating confirmed visits', async () => {
    const { reorderBodies } = setupFetchMock();
    renderEmergencyRouteContent();

    fireEvent.click(await screen.findByRole('button', { name: 'ルートを再計算' }));
    await screen.findByText('移動 +5分');

    fireEvent.click(screen.getByRole('button', { name: '案2を選択' }));
    expect(screen.getByRole('button', { name: '案2を選択' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByTestId('emergency-route-impact').textContent).toContain(
      '患者確認待ち：1件あり',
    );
    expect(screen.getByTestId('emergency-route-impact').textContent).toContain(
      '反映対象：未確定訪問 1件',
    );

    fireEvent.click(screen.getByRole('button', { name: '案2で反映' }));

    const dialog = screen.getByRole('alertdialog', {
      name: '案2を対象日のルートに反映しますか',
    });
    expect(dialog.textContent).toContain('患者B 様');
    expect(dialog.textContent).toContain('確認入力: 再確認済み');
    expect(dialog.textContent).not.toContain('東京都千代田区4-4-4');

    fireEvent.click(within(dialog).getByRole('button', { name: '案2で反映' }));

    await waitFor(() => expect(reorderBodies).toHaveLength(1));
    expect(reorderBodies[0]).toMatchObject({
      updates: [{ schedule_id: 'emergency', route_order: 5 }],
      confirmation_context: {
        source: 'emergency_route_interruption',
        date: '2026-04-09',
        travel_mode: 'DRIVE',
        target_count: 1,
        route_order_diff_count: 1,
        released_schedule_id: 'confirmed_tail',
        patient_reconfirmation_required: true,
      },
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('案2を対象日のルートに反映しました');
  });

  it('blocks applying plan2 when the route engine marks the scenario unavailable', async () => {
    const routeBodies: unknown[] = [];
    const reorderBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/visit-schedules?')) {
        return Response.json({
          data: [confirmedFirst, emergencySchedule, confirmedTail, facilityBatchSchedule],
          hasMore: false,
        });
      }
      if (url === '/api/visit-routes') {
        const body = JSON.parse(String(init?.body));
        routeBodies.push(body);
        const scheduleIds = body.schedule_ids as string[];
        if (scheduleIds.length === 2) {
          return Response.json({ data: routePlan(['confirmed_1', 'confirmed_tail'], 600) });
        }
        if (Array.isArray(body.locked_schedule_ids) && body.locked_schedule_ids.length === 2) {
          return Response.json({
            data: routePlan(['confirmed_1', 'emergency', 'confirmed_tail'], 1200),
          });
        }
        return Response.json({
          data: {
            ...routePlan(['confirmed_1', 'confirmed_tail', 'emergency'], 0),
            status: 'unavailable',
            note: '座標未設定: 緊急患者',
            totalDistanceMeters: null,
            totalDurationSeconds: null,
          },
        });
      }
      if (url === '/api/visit-schedules/reorder') {
        reorderBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ data: { ok: true } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderEmergencyRouteContent();

    fireEvent.click(await screen.findByRole('button', { name: 'ルートを再計算' }));
    await waitFor(() => expect(routeBodies).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: '案2を選択' }));

    expect(screen.getByTestId('emergency-route-impact').textContent).toContain(
      'ルート計算：座標未設定: 緊急患者',
    );
    expect((screen.getByRole('button', { name: '反映不可' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(reorderBodies).toHaveLength(0);
  });
});

describe('buildEmergencyRouteApplyPlan', () => {
  it('blocks inserting before the first confirmed route when no safe route_order slot exists', () => {
    const scheduleById = new Map(
      [confirmedFirst, emergencySchedule].map((schedule) => [schedule.id, schedule]),
    );

    expect(
      buildEmergencyRouteApplyPlan({
        orderedScheduleIds: ['emergency', 'confirmed_1'],
        scheduleById,
      }),
    ).toMatchObject({
      updates: [],
      blockedReason: '確定済み訪問の間に未確定訪問を挿入できる順路番号の空きがありません',
    });
  });
});
