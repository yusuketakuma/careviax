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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('./weekly-cell-inspector', () => ({
  WeeklyCellInspector: (props: {
    onApplyRoute: () => void;
    applyRouteDisabled: boolean;
    applyRoutePending: boolean;
    selectedCaseId: string;
    generateDisabled: boolean;
    generateDisabledReasonId?: string;
  }) => (
    <div>
      <button
        type="button"
        onClick={props.onApplyRoute}
        disabled={props.applyRouteDisabled || props.applyRoutePending}
      >
        最適順を反映
      </button>
      <button
        type="button"
        disabled={props.generateDisabled}
        aria-describedby={props.generateDisabledReasonId}
      >
        {props.selectedCaseId ? 'このセルに提案' : 'ケース選択が必要'}
      </button>
    </div>
  ),
}));

setupDomTestEnv();

import { ScheduleWeeklyOptimizer } from './schedule-weekly-optimizer';
import { toast } from 'sonner';

function buildWeeklySchedule(overrides?: Record<string, unknown>) {
  return {
    id: 'schedule_1',
    display_id: 'vs0000000001',
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
    display_id: 'vsp0000000001',
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
    updated_at: '2026-04-09T08:00:00.000Z',
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

  it('uses an announced skeleton while case search results load', async () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer-search') {
        return { data: undefined, isLoading: true };
      }
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer') {
        return { data: { data: [] }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });

    render(<ScheduleWeeklyOptimizer />);

    fireEvent.change(screen.getByLabelText('提案対象ケース'), {
      target: { value: '山田' },
    });

    expect(await screen.findByRole('status', { name: 'ケース候補を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('ケース候補を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('一致するケースはありません。')).toBeNull();
  });

  it('shows the vehicle resource selector in planner settings', async () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer-search') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'visit-vehicle-resources') {
        return {
          data: {
            data: [
              {
                id: 'vehicle_1',
                label: '軽バン1号',
                travel_mode: 'DRIVE',
                max_stops: 8,
                max_route_duration_minutes: 180,
                available: true,
                site: { id: 'site_1', name: '本店' },
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    render(<ScheduleWeeklyOptimizer />);

    const vehicleSelect = screen.getByLabelText('社用車');
    expect(vehicleSelect).toBeTruthy();
    expect(screen.getByLabelText('希望枠')).toBeTruthy();
    expect(screen.getByLabelText('希望枠 終了')).toBeTruthy();
    fireEvent.mouseDown(vehicleSelect);
    expect(await screen.findByText('軽バン1号 (最大8件 / 180分以内) / 本店')).toBeTruthy();
    expect(screen.getByText('未指定なら自動割当')).toBeTruthy();
  });

  it('warns when the vehicle resource selector hides additional options', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer-search') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'visit-vehicle-resources') {
        return {
          data: {
            data: [],
            total_count: 3,
            visible_count: 1,
            hidden_count: 2,
            truncated: true,
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    render(<ScheduleWeeklyOptimizer />);

    expect(
      screen.getByText((content) => {
        return content.includes('社用車候補が他2') && content.includes('全体の割当可否');
      }),
    ).toBeTruthy();
  });

  it('keeps proposal generation disabled reasons visible until a case is selected', () => {
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
      return { data: undefined, isLoading: false };
    });

    render(
      <ScheduleWeeklyOptimizer
        initialDate="2026-04-09"
        initialRoutePharmacistId="pharmacist_1"
        initialRouteDate="2026-04-09"
      />,
    );

    expect(
      screen
        .getByText('提案対象ケースを選択してから空き枠提案を実行してください')
        .getAttribute('role'),
    ).toBe('alert');
    expect(
      screen.getByRole('button', { name: 'ケース選択が必要' }).getAttribute('aria-describedby'),
    ).toBe('weekly-proposal-case-required-error');
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
          data: {
            data: [
              buildWeeklyProposal({
                medication_end_date: '2026-04-08',
                visit_deadline_date: '2026-04-09',
                proposal_reason: 'アムロジピン増量 / 処方詳細 変更 / 患者条件 09:00-12:00',
              }),
            ],
          },
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
    expect(within(dialog).getByText(/薬剤判断: 服薬最終日 2026\/04\/08/)).toBeTruthy();
    expect(within(dialog).getByText(/開始日前配薬 2026\/04\/09までの候補/)).toBeTruthy();
    expect(within(dialog).getByText(/薬剤根拠 候補理由に根拠あり/)).toBeTruthy();
    expect(within(dialog).getByText(/患者希望枠で順路 1/)).toBeTruthy();
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
    expect(within(dialog).getByText(/ID vsp0000000001/)).toBeTruthy();
    expect(within(dialog).getByText(/ID vs0000000001/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '2件の route_order を反映' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-routes/reorder',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const requestBody = JSON.parse(fetchCalls[0][1].body as string);
    expect(JSON.stringify(requestBody.updates)).not.toContain('vsp0000000001');
    expect(JSON.stringify(requestBody.updates)).not.toContain('vs0000000001');
    expect(requestBody).toEqual({
      updates: [
        {
          item_type: 'proposal',
          id: 'proposal_1',
          route_order: 1,
          expected_route_order: 2,
        },
        {
          item_type: 'schedule',
          id: 'schedule_1',
          route_order: 2,
          expected_route_order: 1,
        },
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

  it('uses an announced skeleton while the weekly board loads', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'cases') return { data: { data: [] }, isLoading: false };
      if (queryKey[0] === 'pharmacist-shifts') {
        return {
          data: undefined,
          isLoading: true,
          isError: false,
          refetch: vi.fn(),
        };
      }
      if (queryKey[0] === 'visit-vehicle-resources') {
        return { data: { data: [] }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });

    render(<ScheduleWeeklyOptimizer initialDate="2026-04-09" />);

    expect(screen.getByRole('status', { name: '週間最適化ビューを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('週間最適化ビューを読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('週間ボードを取得できませんでした')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'この枠に提案' })).toHaveLength(0);
  });

  it('renders a retryable ErrorState — not a false-empty board — when a board query fails', () => {
    const refetchMock = vi.fn();
    // pharmacist-shifts は成功(薬剤師が存在しボードを描画しようとする状況)、
    // visit-schedules の取得だけ失敗させ、空き枠が「予定ゼロ=フリー」に化けないことを検証する。
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'cases') return { data: { data: [] }, isLoading: false };
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
          isError: false,
          refetch: refetchMock,
        };
      }
      if (queryKey[0] === 'visit-vehicle-resources') {
        return { data: { data: [] }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: refetchMock,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        isError: false,
        refetch: refetchMock,
        connected: true,
      };
    });

    render(
      <ScheduleWeeklyOptimizer
        initialDate="2026-04-09"
        initialRoutePharmacistId="pharmacist_1"
        initialRouteDate="2026-04-09"
      />,
    );

    expect(screen.getByText('週間ボードを取得できませんでした')).toBeTruthy();
    const retryButton = screen.getByRole('button', { name: '再読み込み' });
    fireEvent.click(retryButton);
    expect(refetchMock).toHaveBeenCalled();
    // teeth: 取得失敗が「この枠に提案」可能な空きセルボードに化けない。
    expect(screen.queryAllByRole('button', { name: 'この枠に提案' })).toHaveLength(0);
  });

  it('attempts every facility-aggregation proposal and reports a partial-failure summary', async () => {
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
    // 同一施設(同住所)で 2026-04-09 に 2件(=集約先), 別日に 2件(=outliers)。
    const sharedResidence = [{ address: '東京都渋谷区9-9-9', lat: 35.3, lng: 139.3 }];
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedule-proposals') {
        return {
          data: {
            data: [
              buildWeeklyProposal({
                id: 'p_target_1',
                case_id: 'case_t1',
                proposed_date: '2026-04-09',
                case_: { patient: { id: 'pt1', name: '集約先A', residences: sharedResidence } },
              }),
              buildWeeklyProposal({
                id: 'p_target_2',
                case_id: 'case_t2',
                proposed_date: '2026-04-09',
                case_: { patient: { id: 'pt2', name: '集約先B', residences: sharedResidence } },
              }),
              buildWeeklyProposal({
                id: 'p_out_1',
                case_id: 'case_o1',
                proposed_date: '2026-04-10',
                case_: { patient: { id: 'po1', name: '外れ患者1', residences: sharedResidence } },
              }),
              buildWeeklyProposal({
                id: 'p_out_2',
                case_id: 'case_o2',
                proposed_date: '2026-04-11',
                case_: { patient: { id: 'po2', name: '外れ患者2', residences: sharedResidence } },
              }),
            ],
          },
          isLoading: false,
          isError: false,
          connected: true,
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, connected: true };
    });
    // 1件目成功 / 2件目失敗 — Promise.allSettled で両方試行されることを検証。
    let postCount = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postCount += 1;
        if (postCount === 2) {
          return new Response(JSON.stringify({ message: '枠が埋まっています' }), { status: 409 });
        }
        return Response.json({ data: [{ id: 'created' }] });
      }
      return Response.json({ data: {} });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ScheduleWeeklyOptimizer initialDate="2026-04-09" />);

    fireEvent.click(screen.getByRole('button', { name: '同日に集約提案' }));

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      // teeth: 最初の失敗で中断せず 2件とも試行する。
      expect(postCalls).toHaveLength(2);
    });
    await waitFor(() => {
      expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(expect.stringContaining('失敗'));
    });
  });

  it('falls back for facility-aggregation failure reasons with empty Error messages', async () => {
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
    useRealtimeQueryMock.mockImplementation(() => ({
      data: { data: [] },
      isLoading: false,
      isError: false,
      connected: true,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('');
      }),
    );
    render(<ScheduleWeeklyOptimizer initialDate="2026-04-09" />);

    const aggregateOptions = useMutationMock.mock.calls[2]?.[0] as
      | { mutationFn?: (variables?: unknown) => Promise<{ failed: Array<{ reason: string }> }> }
      | undefined;
    const result = await aggregateOptions?.mutationFn?.({
      targetDate: '2026-04-09',
      targetPharmacistId: 'pharmacist_1',
      outliers: [
        buildWeeklyProposal({
          case_: {
            patient: {
              id: 'patient_o1',
              name: '外れ患者1',
              residences: [{ address: '東京都渋谷区9-9-9', lat: 35.3, lng: 139.3 }],
            },
          },
        }),
      ],
    });

    expect(result?.failed).toEqual([{ name: '外れ患者1', reason: '不明なエラー' }]);
  });
});
