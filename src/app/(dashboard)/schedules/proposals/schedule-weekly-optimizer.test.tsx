// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('./weekly-cell-inspector', () => ({
  WeeklyCellInspector: (props: {
    onApplyRoute: () => void;
    applyRouteDisabled: boolean;
    applyRoutePending: boolean;
  }) => (
    <div>
      <button
        type="button"
        onClick={props.onApplyRoute}
        disabled={props.applyRouteDisabled || props.applyRoutePending}
      >
        最適順を反映
      </button>
    </div>
  ),
}));

setupDomTestEnv();

import { ScheduleWeeklyOptimizer } from './schedule-weekly-optimizer';

function buildWeeklySchedule(overrides?: Record<string, unknown>) {
  return {
    id: 'schedule_1',
    case_id: 'case_schedule',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    scheduled_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    confirmed_at: null,
    carry_items_status: 'not_started',
    case_: {
      patient: {
        id: 'patient_schedule',
        name: '山田花子',
        residences: [{ address: '東京都港区1-1-1', lat: 35.1, lng: 139.1 }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都港区2-2-2', lat: 35, lng: 139 },
    preparation: null,
    visit_record: null,
    vehicle_resource: null,
    ...overrides,
  };
}

function buildWeeklyProposal(overrides?: Record<string, unknown>) {
  return {
    id: 'proposal_1',
    case_id: 'case_proposal',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'patient_contact_pending',
    patient_contact_status: 'confirmed',
    proposed_date: '2026-04-09',
    time_window_start: '2026-04-09T10:00:00.000Z',
    time_window_end: '2026-04-09T11:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 2,
    route_distance_score: 1.2,
    medication_end_date: null,
    visit_deadline_date: null,
    proposal_reason: '東京都渋谷区3-3-3 090-1111-2222 アムロジピン 処方詳細',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_proposal',
        name: '佐藤太郎',
        residences: [{ address: '東京都渋谷区3-3-3', lat: 35.2, lng: 139.2 }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都港区2-2-2', lat: 35, lng: 139 },
    vehicle_resource: null,
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
    ...overrides,
  };
}

describe('ScheduleWeeklyOptimizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/schedules/proposals');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('workspace=optimizer'));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer-search') {
        return {
          data: {
            data: [
              {
                id: 'case_1',
                status: 'active',
                primary_pharmacist_id: 'pharmacist_1',
                primary_pharmacist_name: '薬剤師A',
                patient: { id: 'patient_1', name: '山田花子', residences: [] },
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: {} })),
    );
  });

  it('lets users search and pin a case, then syncs it to the URL', () => {
    render(<ScheduleWeeklyOptimizer />);

    fireEvent.change(screen.getByLabelText('提案対象ケース'), {
      target: { value: '山田' },
    });
    fireEvent.click(screen.getByRole('button', { name: /山田花子/ }));

    expect(useRouterMock().replace).toHaveBeenCalledWith(
      expect.stringContaining('optimizer_case_id=case_1'),
      { scroll: false },
    );
  });

  it('shows the vehicle resource selector in planner settings', () => {
    render(<ScheduleWeeklyOptimizer />);

    expect(screen.getByLabelText('社用車')).toBeTruthy();
    expect(screen.getByText('未指定なら自動割当')).toBeTruthy();
  });

  it('requires confirmation before atomically applying mixed weekly route orders', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    useMutationMock.mockImplementation(
      (options: {
        mutationFn?: (variables?: unknown) => unknown;
        onSuccess?: (data: unknown, variables?: unknown) => unknown;
      }) => ({
        mutate: vi.fn((variables?: unknown) => {
          void Promise.resolve(options.mutationFn?.(variables)).then((data) =>
            options.onSuccess?.(data, variables),
          );
        }),
        mutateAsync: vi.fn(),
        isPending: false,
      }),
    );
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer-search') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'pharmacist-shifts') {
        return {
          data: {
            data: [
              {
                id: 'shift_1',
                user_id: 'pharmacist_1',
                site_id: 'site_1',
                date: '2026-04-09',
                available: true,
                available_from: '2026-04-09T09:00:00.000Z',
                available_to: '2026-04-09T18:00:00.000Z',
                user: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
                site: { id: 'site_1', name: '本店' },
              },
            ],
          },
          isLoading: false,
        };
      }
      if (queryKey[0] === 'visit-vehicle-resources') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'weekly-optimizer-route-preview') {
        return {
          data: {
            orderedScheduleIds: ['proposal:proposal_1', 'schedule_1'],
            stopSummaries: [],
          },
          isLoading: false,
          error: null,
        };
      }
      return { data: undefined, isLoading: false };
    });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildWeeklySchedule()] },
          isLoading: false,
          connected: true,
        };
      }
      if (queryKey[0] === 'visit-schedule-proposals') {
        return {
          data: { data: [buildWeeklyProposal()] },
          isLoading: false,
          connected: true,
        };
      }
      return { data: { data: [] }, isLoading: false, connected: true };
    });

    render(
      <ScheduleWeeklyOptimizer
        initialDate="2026-04-09"
        initialRoutePharmacistId="pharmacist_1"
        initialRouteDate="2026-04-09"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '最適順を反映' }));
    expect(fetchMock).not.toHaveBeenCalled();
    let dialog = screen.getByRole('alertdialog', {
      name: '週間ルートの route_order を反映しますか',
    });
    expect(within(dialog).getAllByText('確定予定').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('候補').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('山田花子')).toBeTruthy();
    expect(within(dialog).getByText('佐藤太郎')).toBeTruthy();
    expect(within(dialog).getByText('#2 → #1')).toBeTruthy();
    expect(within(dialog).getByText('#1 → #2')).toBeTruthy();
    expect(dialog.textContent ?? '').not.toContain('東京都渋谷区3-3-3');
    expect(dialog.textContent ?? '').not.toContain('090-1111-2222');
    expect(dialog.textContent ?? '').not.toContain('アムロジピン');
    expect(dialog.textContent ?? '').not.toContain('処方詳細');

    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '最適順を反映' }));
    dialog = screen.getByRole('alertdialog', {
      name: '週間ルートの route_order を反映しますか',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '2件の route_order を反映' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-routes/reorder',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const requestBody = JSON.parse(fetchCalls[0][1].body as string);
    expect(requestBody).toEqual({
      updates: [
        { item_type: 'proposal', id: 'proposal_1', route_order: 1 },
        { item_type: 'schedule', id: 'schedule_1', route_order: 2 },
      ],
      confirmation_context: {
        source: 'weekly_optimizer_mixed_route_preview',
        date: '2026-04-09',
        pharmacist_id: 'pharmacist_1',
        travel_mode: 'DRIVE',
        target_count: 2,
        route_order_diff_count: 2,
      },
    });
  });
});
