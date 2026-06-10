// @vitest-environment jsdom

import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const offlineStoreState = vi.hoisted(() => ({
  isOffline: false,
  pendingSyncCount: 0,
  pendingQueue: [] as never[],
  syncConflicts: [] as Array<{
    id?: number;
    scope_id?: string | null;
    lastError?: string | null;
  }>,
  cacheTtlHours: 24,
  lastSyncRefreshAt: null,
  syncOnlineStatus: vi.fn(),
  refreshSyncState: vi.fn(),
}));
const visitBriefCacheToArrayMock = vi.hoisted(() =>
  vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
);
const visitBriefCacheDeleteMock = vi.hoisted(() => vi.fn(async () => {}));
const visitBriefCacheAddMock = vi.hoisted(() => vi.fn(async () => {}));
const visitBriefCacheWhereMock = vi.hoisted(() =>
  vi.fn((field: string) => ({
    equals: vi.fn(() =>
      field === 'scheduledDate'
        ? { toArray: visitBriefCacheToArrayMock }
        : {
            and: vi.fn(() => ({ delete: visitBriefCacheDeleteMock })),
            delete: visitBriefCacheDeleteMock,
          },
    ),
  })),
);

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
}));

vi.mock('@/components/home-care/home-care-feature-board', () => ({
  HomeCareFeatureHighlights: () => <div />,
}));

vi.mock('@/components/visit-brief/visit-brief-card', () => ({
  VisitBriefCard: () => <div />,
}));

vi.mock('@/components/features/visits/visit-card-mobile', () => ({
  VisitCardMobile: () => <div />,
}));

vi.mock('@/components/features/visits/visit-route-map', () => ({
  VisitRouteMap: () => <div />,
}));

vi.mock('./schedule-metric-card', () => ({
  ScheduleMetricCard: () => <div />,
}));

vi.mock('./schedule-day-view.chrome', () => ({
  OnboardingWarningBadges: () => <div />,
  ScheduleBoardSkeleton: () => <div data-testid="schedule-board-skeleton" />,
}));

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: {
    visitBriefCache: {
      where: visitBriefCacheWhereMock,
      add: visitBriefCacheAddMock,
      delete: visitBriefCacheDeleteMock,
    },
  },
}));

vi.mock('@/lib/stores/offline-store', () => ({
  useOfflineStore: vi.fn((selector: (state: typeof offlineStoreState) => unknown) =>
    selector(offlineStoreState),
  ),
}));

vi.mock('@/lib/stores/sync-engine', () => ({
  discardSyncQueueItem: vi.fn(),
  overwriteVisitRecordConflict: vi.fn(),
  processSyncQueue: vi.fn(),
  setupAutoSync: vi.fn(() => () => {}),
}));

import { ScheduleDayView } from './day-view';

setupDomTestEnv();

async function renderScheduleDayView(ui: ReactElement) {
  const result = render(ui);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

function buildProposal(overrides?: Record<string, unknown>) {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'patient_contact_pending',
    patient_contact_status: 'attempted',
    proposed_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 1,
    route_distance_score: 1.4,
    medication_end_date: '2026-04-10',
    visit_deadline_date: '2026-04-09',
    proposal_reason: '担当薬剤師優先 / 服薬期限内',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1', lat: 35.1, lng: 139.1 }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都千代田区2-2-2', lat: 35.0, lng: 139.0 },
    vehicle_resource: null,
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
    ...overrides,
  };
}

function buildScheduleTask(overrides?: Record<string, unknown>) {
  return {
    id: 'task_1',
    task_type: 'visit_schedule_override_approval',
    title: '変更承認が必要です',
    description: null,
    status: 'pending',
    priority: 'high',
    assigned_to: null,
    due_date: '2026-04-09',
    sla_due_at: null,
    related_entity_type: 'visit_schedule',
    related_entity_id: 'schedule_outside_week',
    metadata: null,
    created_at: '2026-04-09T08:00:00.000Z',
    ...overrides,
  };
}

function buildSchedule(overrides?: Record<string, unknown>) {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    carry_items_status: 'ready',
    scheduled_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    facility_batch_id: null,
    confirmed_at: '2026-04-08T03:00:00.000Z',
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [
          {
            address: '東京都千代田区1-1-1',
            building_id: null,
            unit_name: null,
            lat: 35.1,
            lng: 139.1,
          },
        ],
      },
    },
    site: {
      id: 'site_1',
      name: '本店',
      address: '東京都千代田区2-2-2',
      lat: 35.0,
      lng: 139.0,
    },
    vehicle_resource: null,
    preparation: {
      id: 'preparation_1',
      prepared_at: null,
      medication_changes_reviewed: false,
      carry_items_confirmed: false,
      previous_issues_reviewed: false,
      route_confirmed: false,
      offline_synced: false,
      checklist: {},
    },
    override_request: null,
    applied_override: null,
    facility_hint: null,
    workload_hint: {
      daily_visit_count: 1,
      urgent_visit_count: 0,
    },
    handoff_hint: null,
    ...overrides,
  };
}

describe('ScheduleDayView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    offlineStoreState.isOffline = false;
    offlineStoreState.pendingSyncCount = 0;
    offlineStoreState.pendingQueue = [];
    offlineStoreState.syncConflicts = [];
    offlineStoreState.cacheTtlHours = 24;
    offlineStoreState.lastSyncRefreshAt = null;
    offlineStoreState.syncOnlineStatus = vi.fn();
    offlineStoreState.refreshSyncState = vi.fn();
    visitBriefCacheToArrayMock.mockResolvedValue([]);
    useOrgIdMock.mockReturnValue('');
    useRouterMock.mockReturnValue({ push: vi.fn() });
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useRealtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      connected: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [] })),
    );
  });

  it('renders the schedule board skeleton while org context is bootstrapping', async () => {
    await renderScheduleDayView(<ScheduleDayView />);

    expect(screen.getByTestId('schedule-board-skeleton')).toBeTruthy();
  });

  it('shows the human decision flow on daily proposal cards', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedule-proposals') {
        return {
          data: { data: [buildProposal()] },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        connected: true,
      };
    });

    await renderScheduleDayView(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    expect(screen.getByText('提案から確定まで')).toBeTruthy();
    expect(screen.getAllByText('患者電話確認').length).toBeGreaterThan(0);
    expect(
      screen.getByText('患者へ電話し、結果を「確認済み」で保存すると日時確定できます。'),
    ).toBeTruthy();
  });

  it('opens, resets, and closes the contact log dialog from proposal cards', async () => {
    const mutationCalls: unknown[] = [];
    useMutationMock.mockImplementation(
      (options: { onSuccess?: (data: unknown, variables: unknown) => unknown }) => ({
        mutate: vi.fn((variables: unknown) => {
          mutationCalls.push(variables);
          void options.onSuccess?.({}, variables);
        }),
        mutateAsync: vi.fn(),
        isPending: false,
      }),
    );
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedule-proposals') {
        return {
          data: {
            data: [
              buildProposal({
                patient_contact_status: 'confirmed',
                contact_logs: [
                  {
                    id: 'contact_log_1',
                    outcome: 'confirmed',
                    contact_method: 'fax',
                    contact_name: '家族A',
                    contact_phone: '090-0000-0000',
                    note: '午前希望',
                    callback_due_at: '2026-04-09T12:30:00',
                    called_at: '2026-04-09T09:00:00.000Z',
                    called_by: 'user_1',
                  },
                ],
              }),
            ],
          },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        connected: true,
      };
    });

    await renderScheduleDayView(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    fireEvent.click(screen.getByRole('button', { name: '架電結果を記録' }));

    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('山田花子')).toBeTruthy();
    expect((within(dialog).getByLabelText('対応者名') as HTMLInputElement).value).toBe('家族A');
    expect((within(dialog).getByLabelText('電話番号') as HTMLInputElement).value).toBe(
      '090-0000-0000',
    );
    expect((within(dialog).getByLabelText('折返し予定') as HTMLInputElement).value).toBe(
      '2026-04-09T12:30',
    );

    fireEvent.change(within(dialog).getByLabelText('対応者名'), {
      target: { value: '一時入力' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '架電結果を記録' }));

    dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('対応者名') as HTMLInputElement).value).toBe('家族A');

    fireEvent.click(within(dialog).getByRole('button', { name: '架電結果を保存' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(mutationCalls).toContainEqual({
      id: 'proposal_1',
      payload: expect.objectContaining({
        action: 'contact_attempt',
        contact_method: 'fax',
        contact_name: '家族A',
        contact_phone: '090-0000-0000',
        callback_due_at: new Date('2026-04-09T12:30').toISOString(),
      }),
    });
  });

  it('groups the weekly schedule controls and exposes the selected day state', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });

    await renderScheduleDayView(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    expect(screen.getByRole('heading', { name: '週次訪問の進捗' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '週間ルート運用' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '週間スケジュール' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '訪問候補を生成' })).toBeTruthy();
    expect(screen.getByLabelText('社用車')).toBeTruthy();
    expect(screen.getByText('未指定の場合は患者住所とルート条件から自動割当します')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '運用タスク' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '関連管理' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '前週' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '翌週' })).toBeTruthy();

    const selectedDayButton = screen.getByRole('button', {
      name: /2026年4月9日\(木\) 候補0件 確定0件/,
    });
    expect(selectedDayButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('link', { name: /担当薬剤師の割当/ })).toBeNull();
    expect(screen.getByText('対象ケースを選択すると患者ケースへ移動できます')).toBeTruthy();
  });

  it('requires visible schedule context before showing override approval actions', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'tasks' && queryKey[1] === 'schedule-board') {
        return {
          data: { data: [buildScheduleTask()] },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        connected: true,
      };
    });

    await renderScheduleDayView(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    expect(screen.getByText('変更承認が必要です')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '変更承認' })).toBeNull();
    expect(
      screen.getByText('対象予定をこの週の予定一覧で確認してから変更承認してください。'),
    ).toBeTruthy();
  });

  it('announces confirmed schedule empty states to assistive technology', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    expect(screen.getByRole('status').textContent).toContain('4月9日(木) の確定予定はありません');
  });

  it('keeps the mobile visit mode visible when only sync conflicts remain', async () => {
    offlineStoreState.syncConflicts = [
      {
        id: 42,
        scope_id: 'schedule_conflict',
        lastError: 'server version changed',
      },
    ];
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    expect(screen.getByText('モバイル訪問モード')).toBeTruthy();
    expect(screen.getByText('オンライン')).toBeTruthy();
    expect(screen.getByText('同期待ち 0 件')).toBeTruthy();
    expect(screen.getByText('競合 1 件')).toBeTruthy();
    expect(screen.getByText('409 競合は下のカードで解決します')).toBeTruthy();
    expect(screen.getByText('schedule schedule_conflict / server version changed')).toBeTruthy();
  });

  it('keeps same-facility visit grouping visible and filters unrelated visits', async () => {
    const schedules = [
      buildSchedule({
        id: 'schedule_facility_1',
        route_order: 1,
        facility_batch_id: 'batch_1',
        case_: {
          patient: {
            id: 'patient_facility_1',
            name: '青空一郎',
            residences: [
              {
                address: '東京都千代田区3-3-3',
                building_id: '青空ホーム',
                unit_name: '101',
                lat: 35.11,
                lng: 139.11,
              },
            ],
          },
        },
        facility_hint: {
          label: '青空ホーム',
          patient_count: 2,
          patient_names: ['青空一郎', '青空二郎'],
        },
        preparation: {
          id: 'preparation_facility_1',
          prepared_at: '2026-04-09T07:00:00.000Z',
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: false,
          checklist: {},
        },
      }),
      buildSchedule({
        id: 'schedule_facility_2',
        route_order: 2,
        facility_batch_id: 'batch_1',
        time_window_start: '2026-04-09T09:30:00.000Z',
        time_window_end: '2026-04-09T10:30:00.000Z',
        case_: {
          patient: {
            id: 'patient_facility_2',
            name: '青空二郎',
            residences: [
              {
                address: '東京都千代田区3-3-3',
                building_id: '青空ホーム',
                unit_name: '102',
                lat: 35.12,
                lng: 139.12,
              },
            ],
          },
        },
        facility_hint: {
          label: '青空ホーム',
          patient_count: 2,
          patient_names: ['青空一郎', '青空二郎'],
        },
      }),
      buildSchedule({
        id: 'schedule_single',
        route_order: 3,
        pharmacist_id: 'pharmacist_2',
        time_window_start: '2026-04-09T11:00:00.000Z',
        time_window_end: '2026-04-09T12:00:00.000Z',
        case_: {
          patient: {
            id: 'patient_single',
            name: '佐藤単独',
            residences: [
              {
                address: '東京都中央区4-4-4',
                building_id: null,
                unit_name: null,
                lat: 35.13,
                lng: 139.13,
              },
            ],
          },
        },
      }),
    ];
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: schedules },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        connected: true,
      };
    });

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    expect(screen.getByRole('heading', { name: '同時訪問グループトラッカー' })).toBeTruthy();
    expect(screen.getAllByText('青空ホーム').length).toBeGreaterThan(0);
    expect(screen.getByText('本店 / 対象 2 名')).toBeTruthy();
    expect(screen.getByText('準備完了 1 名')).toBeTruthy();
    expect(screen.getByText('持参物未確認 1 名')).toBeTruthy();
    expect(screen.getByText('未完了 2 名')).toBeTruthy();
    expect(screen.getByText('薬剤師 2 名')).toBeTruthy();
    expect(screen.getByText('確定訪問 3 件')).toBeTruthy();
    expect(screen.getAllByText('佐藤単独').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '青空ホーム' }));

    expect(screen.getAllByText('青空一郎').length).toBeGreaterThan(0);
    expect(screen.getAllByText('青空二郎').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('佐藤単独')).toHaveLength(0);
  });

  it('renders same-start Gantt visits in one stacked cell', async () => {
    const schedules = [
      buildSchedule({
        id: 'same_start_first',
        route_order: 1,
        time_window_start: '2026-04-09T08:00:00',
        time_window_end: '2026-04-09T08:30:00',
        case_: {
          patient: {
            id: 'patient_same_start_first',
            name: '同時刻一郎',
            residences: [
              {
                address: '東京都千代田区5-5-5',
                building_id: null,
                unit_name: null,
                lat: 35.14,
                lng: 139.14,
              },
            ],
          },
        },
      }),
      buildSchedule({
        id: 'same_start_second',
        route_order: 2,
        time_window_start: '2026-04-09T08:00:00',
        time_window_end: '2026-04-09T09:00:00',
        case_: {
          patient: {
            id: 'patient_same_start_second',
            name: '同時刻二郎',
            residences: [
              {
                address: '東京都千代田区6-6-6',
                building_id: null,
                unit_name: null,
                lat: 35.15,
                lng: 139.15,
              },
            ],
          },
        },
      }),
    ];
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: schedules },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        connected: true,
      };
    });

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    const sameStartCell = screen.getByText('同時刻 2件').closest('td');
    expect(sameStartCell?.getAttribute('rowspan')).toBe('2');
    expect(sameStartCell?.textContent).toContain('同時刻一郎');
    expect(sameStartCell?.textContent).toContain('同時刻二郎');
    expect(sameStartCell?.textContent).toContain('#1');
    expect(sameStartCell?.textContent).toContain('#2');
  });

  it('renders staggered overlapping Gantt visits in one stacked cell', async () => {
    const schedules = [
      buildSchedule({
        id: 'overlap_first',
        route_order: 1,
        time_window_start: '2026-04-09T08:00:00',
        time_window_end: '2026-04-09T09:00:00',
        case_: {
          patient: {
            id: 'patient_overlap_first',
            name: '重なり一郎',
            residences: [
              {
                address: '東京都千代田区7-7-7',
                building_id: null,
                unit_name: null,
                lat: 35.16,
                lng: 139.16,
              },
            ],
          },
        },
      }),
      buildSchedule({
        id: 'overlap_second',
        route_order: 2,
        time_window_start: '2026-04-09T08:30:00',
        time_window_end: '2026-04-09T09:30:00',
        case_: {
          patient: {
            id: 'patient_overlap_second',
            name: '重なり二郎',
            residences: [
              {
                address: '東京都千代田区8-8-8',
                building_id: null,
                unit_name: null,
                lat: 35.17,
                lng: 139.17,
              },
            ],
          },
        },
      }),
    ];
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: schedules },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        connected: true,
      };
    });

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    const overlapCell = screen.getByText('重なり 2件').closest('td');
    expect(overlapCell?.getAttribute('rowspan')).toBe('3');
    expect(overlapCell?.textContent).toContain('重なり一郎');
    expect(overlapCell?.textContent).toContain('重なり二郎');
    expect(overlapCell?.textContent).toContain('#1');
    expect(overlapCell?.textContent).toContain('#2');
  });

  it('requires carry-item warning acknowledgement before starting blocked visits', async () => {
    const push = vi.fn();
    useRouterMock.mockReturnValue({ push });
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: {
            data: [
              buildSchedule({
                id: 'schedule_blocked',
                schedule_status: 'ready',
                carry_items_status: 'blocked',
              }),
            ],
          },
          isLoading: false,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        connected: true,
      };
    });

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    fireEvent.click(screen.getByRole('button', { name: '警告を確認して訪問開始' }));

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '持参薬が未確定のままです' })).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('山田花子');
    expect(screen.getByText('持参物ステータス: blocked')).toBeTruthy();

    const confirmationButtons = screen.getAllByRole('button', {
      name: '警告を確認して訪問開始',
    });
    fireEvent.click(confirmationButtons[confirmationButtons.length - 1]);

    expect(push).toHaveBeenCalledWith('/visits/schedule_blocked/record');
  });

  it('drops malformed fresh visit brief cache rows instead of rendering them', async () => {
    visitBriefCacheToArrayMock.mockResolvedValue([
      {
        id: 99,
        scheduleId: 'schedule_1',
        patientId: 'patient_1',
        scheduledDate: '2026-04-09',
        payload: JSON.stringify({
          scheduleId: 'schedule_1',
          patientId: 'patient_1',
          patientName: '山田花子',
          scheduledDate: '2026-04-09',
          timeWindowStart: 'not-a-date',
          timeWindowEnd: null,
          priority: 'normal',
          facilityLabel: null,
          siteName: null,
          headline: '確認事項あり',
          mustCheckToday: [],
          sourceRefs: [],
          generatedAt: '2026-04-09T08:00:00.000Z',
          provider: 'rule',
          isFallback: false,
        }),
        updatedAt: new Date(),
      },
    ]);

    await renderScheduleDayView(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    await waitFor(() => {
      expect(visitBriefCacheDeleteMock).toHaveBeenCalledWith(99);
    });
    expect(screen.queryByText('山田花子')).toBeNull();
  });
});
