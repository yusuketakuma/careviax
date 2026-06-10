// @vitest-environment jsdom

import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { VisitPreparationPack } from './day-view.shared';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const visitCardMobilePropsMock = vi.hoisted(() => vi.fn());
const scheduleDayRoutePreviewPropsMock = vi.hoisted(() => vi.fn());
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
  VisitCardMobile: (props: {
    id: string;
    status: string;
    carryItemsStatus?: string | null;
    mustCheckToday?: string[];
    visitBriefStatus?: 'available' | 'missing' | 'unavailable';
    actionContextLabel?: string;
    onStartVisit?: (id: string) => void;
  }) => {
    visitCardMobilePropsMock(props);
    return (
      <button
        type="button"
        aria-label={`mobile-start-${props.id}`}
        onClick={() => props.onStartVisit?.(props.id)}
      >
        mobile start {props.id}
      </button>
    );
  },
}));

vi.mock('@/components/features/visits/visit-route-map', () => ({
  VisitRouteMap: () => <div />,
}));

vi.mock('./schedule-metric-card', () => ({
  ScheduleMetricCard: () => <div />,
}));

vi.mock('./schedule-day-view.chrome', () => ({
  getOnboardingReadinessWarnings: (readiness: Record<string, boolean>) =>
    [
      ['consent_obtained', '同意未取得'],
      ['first_visit_doc_delivered', '初回文書未交付'],
      ['emergency_contact_set', '緊急連絡先未登録'],
      ['management_plan_approved', '管理計画未承認'],
      ['primary_physician_set', '主治医未設定'],
    ]
      .filter(([key]) => !readiness[key])
      .map(([key, label]) => ({ key, label })),
  OnboardingWarningBadges: ({ readiness }: { readiness: Record<string, boolean> }) => (
    <ul aria-label="訪問前提の未完了項目">
      {[
        ['consent_obtained', '同意未取得'],
        ['first_visit_doc_delivered', '初回文書未交付'],
        ['emergency_contact_set', '緊急連絡先未登録'],
        ['management_plan_approved', '管理計画未承認'],
        ['primary_physician_set', '主治医未設定'],
      ]
        .filter(([key]) => !readiness[key])
        .map(([key, label]) => (
          <li key={key}>{label}</li>
        ))}
    </ul>
  ),
  ScheduleBoardSkeleton: () => <div data-testid="schedule-board-skeleton" />,
}));

vi.mock('./schedule-day-route-preview', () => ({
  ScheduleDayRoutePreview: (props: {
    controlId: string;
    routeTravelMode: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';
    onRouteTravelModeChange: (value: 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER') => void;
  }) => {
    scheduleDayRoutePreviewPropsMock(props);
    return (
      <div data-testid={`route-preview-${props.controlId}`}>
        <span>{props.routeTravelMode}</span>
        <button type="button" onClick={() => props.onRouteTravelModeChange('WALK')}>
          {props.controlId} 徒歩に変更
        </button>
      </div>
    );
  },
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
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
}

function expectStatusAnnouncement(text: string) {
  expect(screen.getAllByRole('status').some((element) => element.textContent?.includes(text))).toBe(
    true,
  );
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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

function buildCompletedPreparation() {
  return {
    id: 'preparation_1',
    prepared_at: '2026-04-09T08:00:00.000Z',
    medication_changes_reviewed: true,
    carry_items_confirmed: true,
    previous_issues_reviewed: true,
    route_confirmed: true,
    offline_synced: true,
    checklist: {},
  };
}

function buildPreparationPack(overrides?: Partial<VisitPreparationPack>): VisitPreparationPack {
  return {
    patient: {
      id: 'patient_1',
      name: '山田花子',
      address: '東京都千代田区1-1-1',
    },
    visit: {
      id: 'schedule_1',
      scheduled_date: '2026-04-09',
      time_window_start: '2026-04-09T09:00:00.000Z',
      time_window_end: '2026-04-09T10:00:00.000Z',
      visit_type: 'regular',
      schedule_status: 'planned',
      priority: 'normal',
      confirmed_at: '2026-04-08T03:00:00.000Z',
    },
    site: {
      id: 'site_1',
      name: '本店',
      address: '東京都千代田区2-2-2',
    },
    handoff: {
      assignment_mode: 'primary',
      summary: '前回から眠気あり。服薬状況を確認。',
    },
    readiness_blockers: ['患者同意が未確認'],
    previous_visit: null,
    open_tasks: [],
    recent_contact_logs: [],
    facility_mode: {
      label: null,
      same_day_patient_count: 1,
      same_day_patient_names: ['山田花子'],
      route_orders: [1],
    },
    facility_parallel_context: null,
    workload: {
      same_day_visit_count: 1,
    },
    care_team: [],
    conference_context: [],
    billing_blockers: [
      {
        key: 'billing_evidence_missing',
        reason: '算定根拠が未確認',
        severity: 'high',
        evidence_id: 'evidence_1',
        visit_record_id: 'visit_record_1',
        action_href: '/billing/evidence_1',
        action_label: '算定根拠を確認',
      },
    ],
    prescription_changes: null,
    medication_period: {
      schedule_start_date: null,
      schedule_end_date: null,
      prescription_start_date: null,
      prescription_end_date: null,
    },
    home_care_feature_highlights: [],
    visit_brief: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
      },
      context: 'schedule',
      generated_at: '2026-04-09T00:00:00.000Z',
      last_prescribed_date: null,
      baseline_context: null,
      medication_changes: [],
      medications: [],
      dispensing_items: [],
      delivery_status: [],
      dosage_form_support: [],
      multidisciplinary_updates: [],
      jahis_supplemental_records: [],
      unresolved_items: [],
      must_check_today: [],
      rule_summary: {
        generation_id: 'rule_1',
        headline: '確認事項なし',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-04-09T00:00:00.000Z',
      },
      ai_summary: {
        generation_id: 'ai_1',
        provider: 'rule',
        requested_provider: 'rule',
        is_fallback: true,
        model: null,
        fallback_reason: null,
        headline: '確認事項なし',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-04-09T00:00:00.000Z',
        duration_ms: null,
        recent_generation_count_24h: 0,
        recent_failure_count_24h: 0,
        recent_failure_rate_24h: null,
      },
      conference_summary: null,
      facility_context: null,
      drug_cautions: [],
    },
    onboarding_readiness: {
      consent_obtained: false,
      emergency_contact_set: true,
      first_visit_doc_delivered: true,
      management_plan_approved: false,
      primary_physician_set: false,
    },
    intake_context: {
      initial_transition_management_expected: null,
    },
    emergency_contacts: [],
    first_visit_document: null,
    ...overrides,
  };
}

function setupPlannerDataQueries() {
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === 'cases') {
      return {
        data: {
          data: [
            {
              id: 'case_1',
              status: 'active',
              primary_pharmacist_id: 'pharmacist_1',
              primary_pharmacist_name: '薬剤師A',
              patient: {
                id: 'patient_1',
                name: '山田花子',
                residences: [{ address: '東京都千代田区1-1-1' }],
              },
            },
          ],
        },
        isLoading: false,
        isFetching: false,
      };
    }
    if (queryKey[0] === 'pharmacists') {
      return {
        data: {
          data: [
            {
              id: 'pharmacist_1',
              name: '薬剤師A',
              name_kana: null,
              role: 'pharmacist',
              site_id: 'site_1',
              site_name: '本店',
            },
          ],
        },
        isLoading: false,
        isFetching: false,
      };
    }
    if (queryKey[0] === 'visit-vehicle-resources') {
      return {
        data: { data: [] },
        isLoading: false,
        isFetching: false,
      };
    }
    if (queryKey[0] === 'visit-schedule-billing-preview') {
      return {
        data: undefined,
        isLoading: false,
        isFetching: false,
      };
    }
    return {
      data: undefined,
      isLoading: false,
      isFetching: false,
    };
  });
}

function executeMutations() {
  useMutationMock.mockImplementation(
    (options: {
      mutationFn?: (variables: unknown) => unknown;
      onSuccess?: (data: unknown, variables: unknown) => unknown;
      onError?: (error: unknown) => unknown;
    }) => ({
      mutate: vi.fn((variables: unknown) => {
        void Promise.resolve(options.mutationFn?.(variables))
          .then((data) => options.onSuccess?.(data, variables))
          .catch((error: unknown) => options.onError?.(error));
      }),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  );
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

  it('uses the initial selected date as the planner start date', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupPlannerDataQueries();

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    expect((screen.getByLabelText('訪問起点日') as HTMLInputElement).value).toBe('2026-04-09');
    const billingPreviewQuery = useQueryMock.mock.calls.find(([options]) => {
      return (
        (options as { queryKey?: unknown[] }).queryKey?.[0] === 'visit-schedule-billing-preview'
      );
    })?.[0] as { queryKey?: unknown[] } | undefined;
    expect(billingPreviewQuery?.queryKey).toEqual([
      'visit-schedule-billing-preview',
      'org_1',
      'case_1',
      '2026-04-09',
      'regular',
      'pharmacist_1',
      'site_1',
    ]);
  });

  it('keeps the planner start date coupled to selected day until manually edited', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    setupPlannerDataQueries();

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    const plannerStartDate = screen.getByLabelText('訪問起点日') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /2026年4月10日\(金\)/ }));
    });

    expect((screen.getByLabelText('週間スケジュールの対象日') as HTMLInputElement).value).toBe(
      '2026-04-10',
    );
    expect(plannerStartDate.value).toBe('2026-04-10');

    await act(async () => {
      fireEvent.change(plannerStartDate, { target: { value: '2026-04-15' } });
      fireEvent.click(screen.getByRole('button', { name: /2026年4月11日\(土\)/ }));
    });

    expect((screen.getByLabelText('週間スケジュールの対象日') as HTMLInputElement).value).toBe(
      '2026-04-11',
    );
    expect(plannerStartDate.value).toBe('2026-04-15');
  });

  it('generates proposals using the initial selected date until the planner date is edited', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    setupPlannerDataQueries();
    executeMutations();

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="proposals" />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '訪問候補を生成' }));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedule-proposals',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
        }),
      );
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      case_id: 'case_1',
      start_date: '2026-04-09',
      candidate_count: 3,
    });

    fireEvent.change(screen.getByLabelText('訪問起点日'), { target: { value: '2026-04-12' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '訪問候補を生成' }));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      case_id: 'case_1',
      start_date: '2026-04-12',
      candidate_count: 3,
    });
  });

  it('keeps route-preview travel mode changes out of planner proposal generation', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    setupPlannerDataQueries();
    executeMutations();
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule()] },
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

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'day-desktop-route 徒歩に変更' }));
    });

    expect(
      scheduleDayRoutePreviewPropsMock.mock.calls.some(([props]) => {
        return (
          (props as { controlId: string; routeTravelMode: string }).controlId ===
            'day-desktop-route' &&
          (props as { controlId: string; routeTravelMode: string }).routeTravelMode === 'WALK'
        );
      }),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '訪問候補を生成' }));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedule-proposals',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
        }),
      );
    });
    const proposalRequest = fetchMock.mock.calls.find(
      ([url]) => url === '/api/visit-schedule-proposals',
    );
    expect(proposalRequest).toBeDefined();
    expect(JSON.parse(proposalRequest?.[1]?.body as string)).toMatchObject({
      case_id: 'case_1',
      travel_mode: 'DRIVE',
    });
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

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="proposals" />,
    );

    expect(screen.getByText('提案から確定まで')).toBeTruthy();
    expect(screen.getAllByText('患者電話確認').length).toBeGreaterThan(0);
    expect(
      screen.getByText('患者へ電話し、結果を「確認済み」で保存すると日時確定できます。'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*架電結果を記録/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*辞退として記録/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*日時を確定/ }),
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

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="proposals" />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*架電結果を記録/,
      }),
    );

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

    fireEvent.click(
      screen.getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*架電結果を記録/,
      }),
    );

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
    expect(screen.getByRole('heading', { name: '日次スケジュールボード' })).toBeTruthy();
    expect(
      screen.getByText('4月9日(木) の候補、確定予定、施設グループ、ルート順を確認します'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: '訪問候補を生成' })).toBeTruthy();
    expect(screen.getByLabelText('社用車')).toBeTruthy();
    expect(screen.getByText('担当薬剤師の拠点設定後に社用車を選択できます')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '運用タスク' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '関連管理' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '前週' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '翌週' })).toBeTruthy();
    expect(screen.getByText('候補 0件')).toBeTruthy();
    expect(screen.getByText('確定 0件')).toBeTruthy();

    const selectedDayButton = screen.getByRole('button', {
      name: /2026年4月9日\(木\) 候補0件 確定0件/,
    });
    expect(selectedDayButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('link', { name: /担当薬剤師の割当/ })).toBeNull();
    expect(screen.getByText('対象ケースを選択すると患者ケースへ移動できます')).toBeTruthy();
  });

  it('opens the confirmed schedule tab by default for daily operations', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });

    await renderScheduleDayView(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    const confirmedTab = screen.getByRole('tab', { name: /当日確定予定/ });
    const proposalsTab = screen.getByRole('tab', { name: /候補一覧/ });
    expect(confirmedTab.getAttribute('aria-selected')).toBe('true');
    expect(proposalsTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('status').textContent).toContain('4月9日(木) の確定予定はありません');
  });

  it('places confirmed visit primary actions before schedule details', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: {
            data: [
              buildSchedule({
                schedule_status: 'ready',
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

    const { container } = await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    const scheduleCard = container.querySelector('#schedule-schedule_1');
    expect(scheduleCard).toBeTruthy();
    const card = scheduleCard as HTMLElement;
    expect(
      within(card).getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*訪問開始/,
      }),
    ).toBeTruthy();
    expect(
      within(card).getAllByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/,
      }),
    ).toHaveLength(1);
    expect(
      within(card).getAllByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*リスケ候補を作る/,
      }),
    ).toHaveLength(1);

    const cardText = card.textContent ?? '';
    expect(cardText.indexOf('訪問開始')).toBeGreaterThan(-1);
    expect(cardText.indexOf('訪問開始')).toBeLessThan(cardText.indexOf('患者住所'));
    expect(cardText.indexOf('訪問準備')).toBeLessThan(cardText.indexOf('患者住所'));
    expect(cardText.indexOf('リスケ候補を作る')).toBeLessThan(cardText.indexOf('患者住所'));
  });

  it('announces proposal loading and empty states to assistive technology', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedule-proposals') {
        return {
          data: undefined,
          isLoading: true,
          connected: true,
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        connected: true,
      };
    });

    const { rerender } = await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="proposals" />,
    );

    expect(screen.getByRole('status').textContent).toContain('訪問候補を読み込んでいます');

    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedule-proposals') {
        return {
          data: { data: [] },
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

    rerender(<ScheduleDayView initialSelectedDate="2026-04-09" initialTab="proposals" />);

    expect(screen.getByRole('status').textContent).toContain('4月9日(木) の候補はありません');
  });

  it('exposes the mobile visit surface selection state', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });

    await renderScheduleDayView(<ScheduleDayView initialSelectedDate="2026-04-09" />);

    const mobileVisitRegion = screen.getByRole('region', { name: '本日の訪問リスト' });
    expect(
      within(mobileVisitRegion).getByRole('heading', { name: '本日の訪問リスト' }),
    ).toBeTruthy();
    expect(
      within(mobileVisitRegion).getByText(
        '右スワイプで開始、訪問中は左スワイプで記録画面へ進みます',
      ),
    ).toBeTruthy();
    const surfaceGroup = within(mobileVisitRegion).getByRole('group', { name: '本日の訪問表示' });
    const listButton = within(surfaceGroup).getByRole('button', { name: 'リスト' });
    const mapButton = within(surfaceGroup).getByRole('button', { name: '地図' });
    expect(listButton.getAttribute('aria-pressed')).toBe('true');
    expect(mapButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(mapButton);

    expect(listButton.getAttribute('aria-pressed')).toBe('false');
    expect(mapButton.getAttribute('aria-pressed')).toBe('true');
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

  it('requires final confirmation before approving a schedule override', async () => {
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
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: {
            data: [
              buildSchedule({
                override_request: {
                  id: 'override_1',
                  status: 'pending',
                  reason: '緊急訪問が割り込んだため',
                  requested_at: '2026-04-09T07:00:00.000Z',
                  approved_at: null,
                  approved_by: null,
                  impact_summary: {
                    impacted_schedule_count: 2,
                    proposed_replacements: 1,
                    impacted_patient_names: ['佐藤太郎'],
                  },
                },
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

    expect(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*リスケ候補を作る/,
      }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*変更承認を確認/,
      }),
    );
    expect(mutationCalls).toEqual([]);
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('山田花子さんの確定済み訪問を変更します')).toBeTruthy();
    expect(dialog.getByText('緊急訪問が割り込んだため')).toBeTruthy();
    expect(dialog.getByText('影響予定 2 件 / 再提案候補 1 件')).toBeTruthy();
    expect(dialog.getByText('佐藤太郎')).toBeTruthy();

    fireEvent.click(dialog.getByRole('button', { name: '山田花子さんの変更を承認' }));
    expect(mutationCalls).toEqual(['schedule_1']);
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

  it('structures the preparation dialog and blocks ready when readiness blockers remain', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith('/api/visit-preparations/schedule_1')) {
        return Response.json({
          data: {
            preparation: null,
            pack: buildPreparationPack(),
          },
        });
      }
      return Response.json({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule()] },
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

    fireEvent.click(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    );

    const dialogElement = screen.getByRole('dialog', {
      name: '山田花子の訪問準備チェック',
      description:
        /2026\/04\/09 18:00 - 19:00 の訪問です。ready に進む前に、処方差分、持参物、前回課題、ルート、オフライン同期を確認します。/,
    });
    const dialog = within(dialogElement);
    expect(dialog.getByRole('heading', { name: '山田花子の訪問準備チェック' })).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: '説明を表示' }));
    expect(dialog.getByRole('tooltip').textContent).toMatch(
      /2026\/04\/09 18:00 - 19:00 の訪問です。ready に進む前に、処方差分、持参物、前回課題、ルート、オフライン同期を確認します。/,
    );
    expect(dialog.getByRole('region', { name: '対象訪問' })).toBeTruthy();
    await waitFor(() => {
      expect(dialog.getByRole('heading', { name: '訪問前提・確認材料' })).toBeTruthy();
    });

    const packRegion = dialog.getByRole('region', { name: '訪問前提・確認材料' });
    const pack = within(packRegion);
    expect(pack.getByRole('heading', { name: '訪問前提・確認材料' }).tagName).toBe('H3');
    expect(pack.getByRole('region', { name: '訪問前の即時確認' })).toBeTruthy();
    expect(pack.getByRole('region', { name: '臨床・算定確認' })).toBeTruthy();
    expect(pack.getByRole('heading', { name: '訪問前の即時確認' }).tagName).toBe('H4');
    expect(pack.getByRole('heading', { name: '臨床・算定確認' }).tagName).toBe('H4');

    const departureRegion = dialog.getByRole('region', { name: '出発直前確認' });
    const departure = within(departureRegion);
    expect(departure.getByRole('heading', { name: '出発直前確認' }).tagName).toBe('H3');
    expect(departure.getByRole('heading', { name: '出発前チェックリスト' }).tagName).toBe('H4');
    expect(departure.getByRole('heading', { name: '訪問先マップ' }).tagName).toBe('H4');
    expect(departure.getByRole('region', { name: '出発前チェックリスト' })).toBeTruthy();
    expect(departure.getByRole('region', { name: '訪問先マップ' })).toBeTruthy();
    expect(packRegion.compareDocumentPosition(departureRegion)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const checklistRegion = departure.getByRole('region', { name: '出発前チェックリスト' });
    const mapRegion = departure.getByRole('region', { name: '訪問先マップ' });
    expect(checklistRegion.compareDocumentPosition(mapRegion)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    expect(dialog.getByRole('region', { name: 'ready 判定' })).toBeTruthy();
    expect(dialog.getByRole('heading', { name: 'ready 判定' })).toBeTruthy();
    const readinessRegion = within(dialog.getByRole('region', { name: 'ready 判定' }));
    const readinessSummary = readinessRegion.getByText('出発前に解決が必要な項目があります。');
    expect(readinessSummary).toBeTruthy();
    expect(readinessSummary.getAttribute('role')).toBe('status');
    expect(readinessSummary.getAttribute('aria-live')).toBe('polite');
    expect(readinessSummary.getAttribute('aria-atomic')).toBe('true');
    expect(dialog.getByRole('list', { name: 'ready 停止カテゴリ' })).toBeTruthy();
    expect(dialog.getByText('訪問前提 1件')).toBeTruthy();
    expect(dialog.getByText('導入準備 3件')).toBeTruthy();
    expect(dialog.getByText('算定確認 1件')).toBeTruthy();
    expect(dialog.getAllByText('患者同意が未確認')).toHaveLength(1);
    expect(dialog.getByText('同意未取得')).toBeTruthy();
    expect(dialog.getByText('管理計画未承認')).toBeTruthy();
    expect(dialog.getByText('主治医未設定')).toBeTruthy();
    expect(dialog.getAllByText('算定根拠が未確認')).toHaveLength(1);
    expect(dialog.getByText('処方差分、薬歴、前回からの用法・薬剤変更を確認します。')).toBeTruthy();

    expect(
      dialog.getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備をreadyに進める/,
      }),
    ).toBeTruthy();
    expect(
      dialog.getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を保存/,
      }),
    ).toBeTruthy();
    const readyButton = dialog.getByRole('button', {
      name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備をreadyに進める/,
    }) as HTMLButtonElement;
    const saveButton = dialog.getByRole('button', {
      name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を保存/,
    }) as HTMLButtonElement;
    expect(dialogElement.querySelector('#preparation-action-target-summary')?.textContent).toMatch(
      /最終操作対象:.*山田花子.*4\/9.*18:00 - 19:00/,
    );
    expect(saveButton.getAttribute('aria-describedby')).toBe('preparation-action-target-summary');
    expect(readyButton.getAttribute('aria-describedby')).toBe(
      'preparation-readiness-summary preparation-readiness-categories preparation-action-target-summary',
    );
    expect(readyButton.disabled).toBe(true);

    const checklist = within(checklistRegion);
    for (const label of [
      '薬歴・前回変更の確認',
      '持参薬・物品確認',
      '前回課題の確認',
      'ルート確認',
      'オフライン同期確認',
    ]) {
      expect(checklist.getByRole('checkbox', { name: label })).toBeTruthy();
    }
    for (const checkbox of checklist.getAllByRole('checkbox')) {
      fireEvent.click(checkbox);
    }

    expect(dialog.getByText('チェックリストはすべて完了しています。')).toBeTruthy();
    expect(readyButton.disabled).toBe(true);
  });

  it('enables ready after all preparation checks when readiness blockers are clear', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith('/api/visit-preparations/schedule_1')) {
        return Response.json({
          data: {
            preparation: null,
            pack: buildPreparationPack({
              readiness_blockers: [
                '薬歴・前回変更の確認',
                '持参薬・物品確認',
                '前回課題の確認',
                'ルート確認',
                'オフライン同期確認',
              ],
              billing_blockers: [],
              onboarding_readiness: {
                consent_obtained: true,
                emergency_contact_set: true,
                first_visit_doc_delivered: true,
                management_plan_approved: true,
                primary_physician_set: true,
              },
            }),
          },
        });
      }
      return Response.json({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule()] },
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

    fireEvent.click(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    );

    const dialogElement = screen.getByRole('dialog');
    const dialog = within(dialogElement);
    await waitFor(() => {
      expect(dialog.getByText('出発前に解決が必要な項目があります。')).toBeTruthy();
    });
    expect(dialog.getByText('訪問前提 5件')).toBeTruthy();

    const readinessRegion = within(dialog.getByRole('region', { name: 'ready 判定' }));
    const checklist = within(dialog.getByRole('region', { name: '出発前チェックリスト' }));
    const readyButton = dialog.getByRole('button', {
      name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備をreadyに進める/,
    }) as HTMLButtonElement;
    expect(readinessRegion.getByText('ready 停止中')).toBeTruthy();
    expect(readyButton.disabled).toBe(true);

    for (const checkbox of checklist.getAllByRole('checkbox')) {
      fireEvent.click(checkbox);
    }

    expect(checklist.getByText('チェックリストはすべて完了しています。')).toBeTruthy();
    expect(readinessRegion.getByText('ready に進める状態です。')).toBeTruthy();
    expect(readinessRegion.getByText('ready 可能')).toBeTruthy();
    expect(readyButton.getAttribute('aria-describedby')).toBe(
      'preparation-readiness-summary preparation-action-target-summary',
    );
    expect(dialogElement.querySelector('#preparation-readiness-summary')?.textContent).toContain(
      'ready に進める状態です。',
    );
    expect(readyButton.disabled).toBe(false);
  });

  it('keeps ready disabled when onboarding readiness is unknown', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith('/api/visit-preparations/schedule_1')) {
        return Response.json({
          data: {
            preparation: buildCompletedPreparation(),
            pack: buildPreparationPack({
              readiness_blockers: [],
              billing_blockers: [],
              onboarding_readiness: null,
            }),
          },
        });
      }
      return Response.json({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule()] },
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

    fireEvent.click(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    );

    const dialog = within(screen.getByRole('dialog'));
    await waitFor(() => {
      expect(dialog.getByText('導入準備の状態を確認できません。')).toBeTruthy();
    });

    const readyButton = dialog.getByRole('button', {
      name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備をreadyに進める/,
    }) as HTMLButtonElement;
    expect(dialog.getByText('導入準備 不明')).toBeTruthy();
    expect(readyButton.disabled).toBe(true);
  });

  it('keeps ready disabled when the latest preparation pack cannot be loaded', async () => {
    useMutationMock.mockImplementation(
      (options: {
        mutationFn?: (variables: unknown) => unknown;
        onSuccess?: (data: unknown, variables: unknown) => unknown;
        onError?: (error: unknown) => unknown;
      }) => ({
        mutate: vi.fn((variables: unknown) => {
          void Promise.resolve(options.mutationFn?.(variables))
            .then((data) => options.onSuccess?.(data, variables))
            .catch((error: unknown) => options.onError?.(error));
        }),
        mutateAsync: vi.fn(),
        isPending: false,
      }),
    );
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).startsWith('/api/visit-preparations/schedule_1')) {
        if (init?.method === 'PUT') {
          return Response.json({ data: { id: 'preparation_1' } });
        }
        return Response.json({ message: 'pack unavailable' }, { status: 500 });
      }
      return Response.json({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule()] },
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

    fireEvent.click(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    );

    const dialog = within(screen.getByRole('dialog'));
    await waitFor(() => {
      expect(
        dialog.getByText('最新の訪問準備情報を取得できないため ready にできません。'),
      ).toBeTruthy();
    });

    const readyButton = dialog.getByRole('button', {
      name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備をreadyに進める/,
    }) as HTMLButtonElement;
    const saveButton = dialog.getByRole('button', {
      name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を保存/,
    }) as HTMLButtonElement;
    expect(dialog.getByRole('alert')).toBeTruthy();
    expect(saveButton.disabled).toBe(false);
    expect(readyButton.disabled).toBe(true);

    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).startsWith('/api/visit-preparations/schedule_1') &&
            init?.method === 'PUT',
        ),
      ).toBe(true);
    });

    fireEvent.click(readyButton);

    expect(
      fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/visit-schedules/')),
    ).toBe(false);
  });

  it('does not overwrite checklist edits when the preparation details fetch resolves later', async () => {
    const deferred = createDeferred<Response>();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input).startsWith('/api/visit-preparations/schedule_1')) {
        return deferred.promise;
      }
      return Promise.resolve(Response.json({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule()] },
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

    fireEvent.click(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    );

    const dialog = within(screen.getByRole('dialog'));
    const medicationCheckbox = dialog.getByRole('checkbox', {
      name: '薬歴・前回変更の確認',
    });
    const carryCheckbox = dialog.getByRole('checkbox', {
      name: '持参薬・物品確認',
    });
    expect(medicationCheckbox.getAttribute('aria-checked')).toBe('false');
    expect(carryCheckbox.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(medicationCheckbox);
    expect(medicationCheckbox.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      deferred.resolve(
        Response.json({
          data: {
            preparation: buildCompletedPreparation(),
            pack: buildPreparationPack({
              readiness_blockers: [],
              billing_blockers: [],
              onboarding_readiness: {
                consent_obtained: true,
                emergency_contact_set: true,
                first_visit_doc_delivered: true,
                management_plan_approved: true,
                primary_physician_set: true,
              },
            }),
          },
        }),
      );
      await deferred.promise;
    });

    await waitFor(() => {
      expect(dialog.getByRole('heading', { name: '訪問前提・確認材料' })).toBeTruthy();
    });
    expect(medicationCheckbox.getAttribute('aria-checked')).toBe('true');
    expect(carryCheckbox.getAttribute('aria-checked')).toBe('false');
    expect(dialog.getByText(/未完了: 持参薬・物品確認/)).toBeTruthy();
  });

  it('keeps ready disabled when the preparation pack belongs to a different schedule or patient', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).startsWith('/api/visit-preparations/schedule_1')) {
        return Response.json({
          data: {
            preparation: buildCompletedPreparation(),
            pack: buildPreparationPack({
              patient: {
                id: 'patient_2',
                name: '別患者',
                address: '東京都港区9-9-9',
              },
              visit: {
                id: 'schedule_2',
                scheduled_date: '2026-04-09',
                time_window_start: '2026-04-09T09:00:00.000Z',
                time_window_end: '2026-04-09T10:00:00.000Z',
                visit_type: 'regular',
                schedule_status: 'planned',
                priority: 'normal',
                confirmed_at: '2026-04-08T03:00:00.000Z',
              },
            }),
          },
        });
      }
      return Response.json({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule()] },
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

    fireEvent.click(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    );

    const dialog = within(screen.getByRole('dialog'));
    await waitFor(() => {
      expect(
        dialog.getByText('取得した訪問準備情報が現在の患者・訪問予定と一致しません。'),
      ).toBeTruthy();
    });

    const readyButton = dialog.getByRole('button', {
      name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備をreadyに進める/,
    }) as HTMLButtonElement;
    const saveButton = dialog.getByRole('button', {
      name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を保存/,
    }) as HTMLButtonElement;
    expect(dialog.queryByText('別患者')).toBeNull();
    expect(dialog.queryByText('東京都港区9-9-9')).toBeNull();
    expect(dialog.getByText(/未完了: 薬歴・前回変更の確認/)).toBeTruthy();
    expect(saveButton.disabled).toBe(true);
    expect(readyButton.disabled).toBe(true);

    fireEvent.click(readyButton);

    expect(
      fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/visit-schedules/')),
    ).toBe(false);
  });

  it('ignores stale preparation responses when the same schedule is reopened', async () => {
    const preparationResponses: Array<ReturnType<typeof createDeferred<Response>>> = [];
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input).startsWith('/api/visit-preparations/schedule_1')) {
        const deferred = createDeferred<Response>();
        preparationResponses.push(deferred);
        return deferred.promise;
      }
      return Promise.resolve(Response.json({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule()] },
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

    fireEvent.click(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    );
    await waitFor(() => {
      expect(preparationResponses).toHaveLength(1);
    });

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '閉じる' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備を開く/ }),
    );
    await waitFor(() => {
      expect(preparationResponses).toHaveLength(2);
    });

    await act(async () => {
      preparationResponses[0].resolve(
        Response.json({
          data: {
            preparation: buildCompletedPreparation(),
            pack: buildPreparationPack({
              readiness_blockers: [],
              billing_blockers: [],
              onboarding_readiness: {
                consent_obtained: true,
                emergency_contact_set: true,
                first_visit_doc_delivered: true,
                management_plan_approved: true,
                primary_physician_set: true,
              },
            }),
          },
        }),
      );
      await preparationResponses[0].promise;
    });

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('最新の訪問準備情報を読み込み中です。')).toBeTruthy();
    expect(dialog.queryByText('ready に進める状態です。')).toBeNull();
    expect(
      (
        dialog.getByRole('button', {
          name: /山田花子.*4\/9.*18:00 - 19:00.*訪問準備をreadyに進める/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await act(async () => {
      preparationResponses[1].resolve(
        Response.json({
          data: {
            preparation: null,
            pack: buildPreparationPack({
              readiness_blockers: ['患者同意が未確認'],
            }),
          },
        }),
      );
      await preparationResponses[1].promise;
    });

    await waitFor(() => {
      expect(dialog.getByText('出発前に解決が必要な項目があります。')).toBeTruthy();
    });
    expect(dialog.getByText('訪問前提 1件')).toBeTruthy();
    expect(dialog.queryByText('ready に進める状態です。')).toBeNull();
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

    const facilityOrderList = screen.getByRole('list', { name: '青空ホームの訪問順序' });
    const getFacilityPatientOrder = () =>
      within(facilityOrderList)
        .getAllByText(/^青空[一二]郎$/)
        .map((element) => element.textContent);

    expect(getFacilityPatientOrder()).toEqual(['青空一郎', '青空二郎']);
    expect(within(facilityOrderList).getByText('現在 1 / 2番目')).toBeTruthy();
    expect(within(facilityOrderList).getByText('現在 2 / 2番目')).toBeTruthy();
    expect(
      (
        within(facilityOrderList).getByRole('button', {
          name: '青空ホーム 青空一郎を1つ上へ移動',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(facilityOrderList).getByRole('button', {
          name: '青空ホーム 青空二郎を1つ下へ移動',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(
      within(facilityOrderList).getByRole('button', {
        name: '青空ホーム 青空一郎を1つ下へ移動',
      }),
    );

    expect(getFacilityPatientOrder()).toEqual(['青空二郎', '青空一郎']);
    expectStatusAnnouncement('青空ホーム 青空一郎を2 / 2番目に移動しました');
    expect(
      (
        within(facilityOrderList).getByRole('spinbutton', {
          name: '青空ホーム 青空一郎 の訪問順序',
        }) as HTMLInputElement
      ).value,
    ).toBe('2');
    expect(
      (
        within(facilityOrderList).getByRole('spinbutton', {
          name: '青空ホーム 青空二郎 の訪問順序',
        }) as HTMLInputElement
      ).value,
    ).toBe('1');

    fireEvent.click(
      within(facilityOrderList).getByRole('button', {
        name: '青空ホーム 青空一郎を1つ上へ移動',
      }),
    );

    expect(getFacilityPatientOrder()).toEqual(['青空一郎', '青空二郎']);
    expectStatusAnnouncement('青空ホーム 青空一郎を1 / 2番目に移動しました');

    fireEvent.click(screen.getByRole('button', { name: '青空ホーム' }));

    expect(screen.getAllByText('青空一郎').length).toBeGreaterThan(0);
    expect(screen.getAllByText('青空二郎').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('佐藤単独')).toHaveLength(0);
  });

  it('saves facility visit order changed with move buttons', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: { id: 'batch_1' } }));
    vi.stubGlobal('fetch', fetchMock);
    useMutationMock.mockImplementation(
      (options: {
        mutationFn?: (variables: unknown) => unknown;
        onSuccess?: (data: unknown, variables: unknown) => unknown;
        onError?: (error: unknown) => unknown;
      }) => ({
        mutate: vi.fn((variables: unknown) => {
          void Promise.resolve(options.mutationFn?.(variables))
            .then((data) => options.onSuccess?.(data, variables))
            .catch((error: unknown) => options.onError?.(error));
        }),
        mutateAsync: vi.fn(),
        isPending: false,
      }),
    );
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
      }),
      buildSchedule({
        id: 'schedule_facility_2',
        route_order: 2,
        facility_batch_id: 'batch_1',
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

    const facilityOrderList = screen.getByRole('list', { name: '青空ホームの訪問順序' });
    fireEvent.click(
      within(facilityOrderList).getByRole('button', {
        name: '青空ホーム 青空二郎を1つ上へ移動',
      }),
    );

    expect(within(facilityOrderList).getByText('現在 1 / 2番目')).toBeTruthy();
    expectStatusAnnouncement('青空ホーム 青空二郎を1 / 2番目に移動しました');
    expect(
      (
        within(facilityOrderList).getByRole('spinbutton', {
          name: '青空ホーム 青空二郎 の訪問順序',
        }) as HTMLInputElement
      ).value,
    ).toBe('1');
    expect(
      (
        within(facilityOrderList).getByRole('spinbutton', {
          name: '青空ホーム 青空一郎 の訪問順序',
        }) as HTMLInputElement
      ).value,
    ).toBe('2');

    expect(screen.getByRole('button', { name: '青空ホームの定期訪問日を設定' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '青空ホーム 2名の持参確認を一括反映' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '青空ホーム 2名の同時訪問順序を保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/facility-visit-batches',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const facilityBatchCalls = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/facility-visit-batches',
    );
    const facilityBatchCall = facilityBatchCalls[0];
    expect(facilityBatchCall).toBeTruthy();
    const requestInit = facilityBatchCall?.[1];
    expect(requestInit).toBeTruthy();
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      }),
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual(
      expect.objectContaining({
        ordered_schedule_ids: ['schedule_facility_2', 'schedule_facility_1'],
        carry_items_confirmed: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '青空ホーム 2名の持参確認を一括反映' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => url === '/api/facility-visit-batches'),
      ).toHaveLength(2);
    });
    const carryConfirmRequestInit = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/facility-visit-batches',
    )[1]?.[1];
    expect(JSON.parse(String(carryConfirmRequestInit?.body))).toEqual(
      expect.objectContaining({
        ordered_schedule_ids: ['schedule_facility_2', 'schedule_facility_1'],
        carry_items_confirmed: true,
      }),
    );
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

    const ganttTable = screen.getByRole('table', { name: /日次ガント表/ });
    expect(ganttTable.querySelector('th[scope="col"]')?.textContent).toContain('時間');
    expect(ganttTable.querySelector('th[scope="row"]')).toBeTruthy();
    expect(screen.getByRole('group', { name: /患者 同時刻一郎.*同時刻 2件/ })).toBeTruthy();
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

  it('blocks visit start when carry items are blocked', async () => {
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

    fireEvent.click(
      screen.getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*持参物未確定を確認/,
      }),
    );

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '持参薬が未確定のままです' })).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('山田花子');
    expect(screen.getByText('持参物ステータス: blocked')).toBeTruthy();
    expect(
      screen.getByText('持参物を確定するか代替手配を記録してから、訪問を開始してください。'),
    ).toBeTruthy();

    const blockedStartButton = screen.getByRole('button', {
      name: '持参物を確定してから開始',
    }) as HTMLButtonElement;
    expect(blockedStartButton.disabled).toBe(true);
    fireEvent.click(blockedStartButton);

    expect(push).not.toHaveBeenCalled();
  });

  it('requires explicit acknowledgement before starting partial carry-item visits', async () => {
    const push = vi.fn();
    useRouterMock.mockReturnValue({ push });
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: {
            data: [
              buildSchedule({
                id: 'schedule_partial',
                schedule_status: 'ready',
                carry_items_status: 'partial',
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

    fireEvent.click(
      screen.getByRole('button', {
        name: /山田花子.*4\/9.*18:00 - 19:00.*警告を確認して訪問開始/,
      }),
    );

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '持参物の一部が未確定です' })).toBeTruthy();
    expect(screen.getByText('持参物ステータス: partial')).toBeTruthy();
    const confirmationButton = screen.getByRole('button', {
      name: '警告を確認して訪問開始',
    }) as HTMLButtonElement;
    expect(confirmationButton.disabled).toBe(true);

    fireEvent.click(confirmationButton);
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
      }),
    );
    expect(confirmationButton.disabled).toBe(false);

    fireEvent.click(confirmationButton);

    expect(push).toHaveBeenCalledWith('/visits/schedule_partial/record');
  });

  it('routes mobile start actions through the carry-item warning gate', async () => {
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

    expect(visitCardMobilePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'schedule_blocked',
        status: 'ready',
        carryItemsStatus: 'blocked',
        actionContextLabel: '山田花子 4/9 18:00 - 19:00',
        onStartVisit: expect.any(Function),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'mobile-start-schedule_blocked' }));

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '持参薬が未確定のままです' })).toBeTruthy();
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

  it('ignores cached visit briefs whose patient no longer matches the live schedule', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    offlineStoreState.isOffline = true;
    useOrgIdMock.mockReturnValue('org_1');
    visitBriefCacheToArrayMock.mockResolvedValue([
      {
        id: 101,
        scheduleId: 'schedule_patient_changed',
        patientId: 'patient_cached',
        scheduledDate: '2026-04-09',
        payload: JSON.stringify({
          scheduleId: 'schedule_patient_changed',
          patientId: 'patient_cached',
          patientName: '誤患者',
          scheduledDate: '2026-04-09',
          timeWindowStart: '2026-04-09T09:00:00.000Z',
          timeWindowEnd: '2026-04-09T10:00:00.000Z',
          priority: 'normal',
          facilityLabel: null,
          siteName: null,
          headline: '誤患者のブリーフ',
          mustCheckToday: ['誤患者の確認事項'],
          sourceRefs: [],
          generatedAt: '2026-04-09T08:00:00.000Z',
          provider: 'rule',
          isFallback: false,
        }),
        updatedAt: new Date(),
      },
    ]);
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: {
            data: [
              buildSchedule({
                id: 'schedule_patient_changed',
                case_: {
                  patient: {
                    id: 'patient_live',
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

    await waitFor(() => {
      expect(visitCardMobilePropsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'schedule_patient_changed',
          mustCheckToday: [],
        }),
      );
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-preparations/brief-batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ schedule_ids: ['schedule_patient_changed'] }),
        }),
      );
    });
    await waitFor(() => {
      expect(visitCardMobilePropsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'schedule_patient_changed',
          visitBriefStatus: 'unavailable',
        }),
      );
    });
    expect(screen.queryByText('誤患者')).toBeNull();
    expect(screen.queryByText('誤患者の確認事項')).toBeNull();
  });

  it('clears the previous day cached visit briefs when cache loading fails after a date change', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    offlineStoreState.isOffline = true;
    useOrgIdMock.mockReturnValue('org_1');
    visitBriefCacheToArrayMock
      .mockResolvedValueOnce([
        {
          id: 102,
          scheduleId: 'schedule_1',
          patientId: 'patient_1',
          scheduledDate: '2026-04-09',
          payload: JSON.stringify({
            scheduleId: 'schedule_1',
            patientId: 'patient_1',
            patientName: '山田花子',
            scheduledDate: '2026-04-09',
            timeWindowStart: '2026-04-09T09:00:00.000Z',
            timeWindowEnd: '2026-04-09T10:00:00.000Z',
            priority: 'normal',
            facilityLabel: null,
            siteName: null,
            headline: '前日のブリーフ',
            mustCheckToday: ['前日の確認事項'],
            sourceRefs: [],
            generatedAt: '2026-04-09T08:00:00.000Z',
            provider: 'rule',
            isFallback: false,
          }),
          updatedAt: new Date(),
        },
      ])
      .mockRejectedValueOnce(new Error('idb unavailable'));
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: {
            data: [
              buildSchedule(),
              buildSchedule({
                id: 'schedule_next_day',
                scheduled_date: '2026-04-10',
                time_window_start: '2026-04-10T09:00:00.000Z',
                time_window_end: '2026-04-10T10:00:00.000Z',
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

    await waitFor(() => {
      expect(screen.getByText('前日のブリーフ')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /2026年4月10日\(金\)/ }));
    });

    await waitFor(() => {
      expect(screen.queryByText('前日のブリーフ')).toBeNull();
    });
    expect(screen.getByText('この日の軽量 brief キャッシュはまだありません。')).toBeTruthy();
    expect(screen.getByText('ブリーフ 0/1 件')).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(
      '[visit-brief-cache] Failed to load schedule brief cache',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('surfaces offline cache load failure when no visit brief refresh can run', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    visitBriefCacheToArrayMock.mockRejectedValue(new Error('indexeddb read failed'));
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });

    await renderScheduleDayView(
      <ScheduleDayView initialSelectedDate="2026-04-09" initialTab="confirmed" />,
    );

    expect(
      await screen.findByText('端末キャッシュを読み込めません。患者詳細と処方を確認してください。'),
    ).toBeTruthy();
    expect(screen.getByText('ブリーフ対象 0 件')).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(
      '[visit-brief-cache] Failed to load schedule brief cache',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('refreshes missing visit briefs when offline cache loading fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    visitBriefCacheToArrayMock.mockRejectedValue(new Error('indexeddb read failed'));
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: { data: [buildSchedule({ id: 'schedule_cache_recover' })] },
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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-preparations/brief-batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ schedule_ids: ['schedule_cache_recover'] }),
        }),
      );
    });
    expect(screen.getByText('ブリーフ 0/1 件')).toBeTruthy();
    expect(
      screen.getByText('軽量 brief を更新できません。患者詳細と処方を確認してください。'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(visitCardMobilePropsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'schedule_cache_recover',
          visitBriefStatus: 'unavailable',
        }),
      );
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[visit-brief-cache] Failed to load schedule brief cache',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
