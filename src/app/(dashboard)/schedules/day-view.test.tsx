// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
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
  useOfflineStore: vi.fn(
    (
      selector: (state: {
        isOffline: boolean;
        pendingSyncCount: number;
        pendingQueue: never[];
        syncConflicts: never[];
        cacheTtlHours: number;
        lastSyncRefreshAt: null;
        syncOnlineStatus: ReturnType<typeof vi.fn>;
        refreshSyncState: ReturnType<typeof vi.fn>;
      }) => unknown,
    ) =>
      selector({
        isOffline: false,
        pendingSyncCount: 0,
        pendingQueue: [],
        syncConflicts: [],
        cacheTtlHours: 24,
        lastSyncRefreshAt: null,
        syncOnlineStatus: vi.fn(),
        refreshSyncState: vi.fn(),
      }),
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

describe('ScheduleDayView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it('renders the schedule board skeleton while org context is bootstrapping', () => {
    render(<ScheduleDayView />);

    expect(screen.getByTestId('schedule-board-skeleton')).toBeTruthy();
  });

  it('shows the human decision flow on daily proposal cards', () => {
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

    render(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    expect(screen.getByText('提案から確定まで')).toBeTruthy();
    expect(screen.getAllByText('患者電話確認').length).toBeGreaterThan(0);
    expect(
      screen.getByText('患者へ電話し、結果を「確認済み」で保存すると日時確定できます。'),
    ).toBeTruthy();
  });

  it('groups the weekly schedule controls and exposes the selected day state', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });

    render(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    expect(screen.getByRole('heading', { name: '週次訪問の進捗' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '週間ルート運用' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '週間スケジュール' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '訪問候補を生成' })).toBeTruthy();
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

  it('requires visible schedule context before showing override approval actions', () => {
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

    render(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    expect(screen.getByText('変更承認が必要です')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '変更承認' })).toBeNull();
    expect(
      screen.getByText('対象予定をこの週の予定一覧で確認してから変更承認してください。'),
    ).toBeTruthy();
  });

  it('announces confirmed schedule empty states to assistive technology', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });

    render(<ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />);

    expect(screen.getByRole('status').textContent).toContain('4月9日(木) の確定予定はありません');
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

    render(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    await waitFor(() => {
      expect(visitBriefCacheDeleteMock).toHaveBeenCalledWith(99);
    });
    expect(screen.queryByText('山田花子')).toBeNull();
  });
});
