// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { stubJsonFetch } from '@/test/fetch-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import type {
  DashboardCockpitCommentsResponse,
  DashboardCockpitDetailsResponse,
  DashboardCockpitInboundResponse,
  DashboardCockpitResponse,
  DashboardCockpitSummaryResponse,
  DashboardCockpitTeamResponse,
  DashboardUrgentItem,
} from '@/types/dashboard-cockpit';

setupDomTestEnv();

const { useRealtimeQueryMock, refetchMock } = vi.hoisted(() => ({
  useRealtimeQueryMock: vi.fn(),
  refetchMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

import { DashboardCockpit } from './dashboard-cockpit';
import { formatCockpitGeneratedAtMeta } from './dashboard-cockpit.helpers';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

function buildUrgentFixture(): DashboardUrgentItem[] {
  return [
    {
      id: 'audit:task_1',
      source: 'audit',
      source_id: 'task_1',
      source_label: '麻薬監査',
      reference_label: 'RX-2024-0500',
      severity: 'blocking',
      patient_id: null,
      patient_name: '田中 一郎',
      title: '麻薬を含む監査待ち',
      summary: '麻薬を含む監査待ちです。完了しないと訪問の持参準備が始まりません。',
      due_at: localIso(12, 0),
      waiting_since: localIso(8, 0),
      badges: [
        { label: '麻薬', tone: 'danger' },
        { label: '冷所', tone: 'warning' },
      ],
      action_href: '/audit',
      action_label: '監査を開始する',
    },
    {
      id: 'inbound:event_1',
      source: 'inbound',
      source_id: 'event_1',
      source_label: 'MCS',
      reference_label: 'nurse',
      severity: 'urgent',
      patient_id: 'patient_1',
      patient_name: '田中 一郎',
      title: 'MCS受信: 安全確認が必要',
      summary: '湿布 / 4sheet / 湿布は残り4枚',
      due_at: localIso(9, 18),
      waiting_since: localIso(9, 18),
      badges: [
        { label: '安全確認', tone: 'danger' },
        { label: '確認待ち', tone: 'warning' },
      ],
      action_href: '/patients/patient_1#inbound-communications',
      action_label: '受信情報を確認',
    },
    {
      id: 'task:exception_1',
      source: 'task',
      source_id: 'exception_1',
      source_label: '止まっている理由',
      reference_label: '患者',
      severity: 'blocking',
      patient_id: null,
      patient_name: null,
      title: 'ご家族の同意待ち(新規契約)',
      summary: '患者: ご家族の同意待ち(新規契約)',
      due_at: null,
      waiting_since: localIso(8, 42),
      badges: [
        { label: '患者', tone: 'warning' },
        { label: '重大', tone: 'danger' },
      ],
      action_href: '/patients',
      action_label: '再連絡する',
    },
    {
      id: 'audit:task_2',
      source: 'audit',
      source_id: 'task_2',
      source_label: '調剤監査',
      reference_label: 'RX-2024-0473',
      severity: 'warning',
      patient_id: null,
      patient_name: '佐々木 ハル',
      title: '調剤監査待ち',
      summary: '調剤済みの監査待ちです。完了でセット・訪問準備に進めます。',
      due_at: null,
      waiting_since: localIso(7, 42),
      badges: [{ label: '安全タグなし', tone: 'neutral' }],
      action_href: '/audit',
      action_label: '監査を開始する',
    },
  ];
}

function buildFixture(): DashboardCockpitResponse {
  const urgentItems = buildUrgentFixture();
  return {
    generated_at: localIso(9, 42),
    cycle_status_counts: {
      intake_received: 4,
      structuring: 7,
      inquiry_pending: 18,
      ready_to_dispense: 9,
      dispensed: 10,
      audit_pending: 14,
      setting: 21,
      visit_ready: 6,
      visit_completed: 11,
      reported: 9,
    },
    audit_pending_count: 6,
    narcotic_audit_count: 1,
    audit_queue: [
      {
        task_id: 'task_1',
        cycle_id: 'cycle_1',
        patient_name: '田中 一郎',
        priority: 'urgent',
        due_at: localIso(12, 0),
        intake_id: 'intake_0500',
        prescribed_date: '2024-05-01',
        handling_tags: ['narcotic', 'cold_storage'],
        has_narcotic: true,
        waiting_since: localIso(8, 0),
      },
      {
        task_id: 'task_2',
        cycle_id: 'cycle_2',
        patient_name: '佐々木 ハル',
        priority: 'normal',
        due_at: null,
        intake_id: 'intake_0473',
        prescribed_date: '2024-04-20',
        handling_tags: [],
        has_narcotic: false,
        waiting_since: localIso(7, 42),
      },
    ],
    urgent_items: urgentItems,
    urgent_total_count: 8,
    urgent_visible_count: urgentItems.length,
    urgent_hidden_count: 4,
    today_visits: [
      {
        id: 'visit_1',
        patient_name: '伊藤',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: '10:30',
        time_end: '11:30',
        facility_batch_id: null,
      },
      {
        id: 'visit_2',
        patient_name: '田中',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: '14:00',
        time_end: '15:00',
        facility_batch_id: null,
      },
    ],
    blocked_reasons: [
      {
        id: 'exception_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/patients',
      },
      {
        id: 'exception_2',
        label: '送付先の確認(やまもと内科)',
        severity: 'warning',
        category: '事務',
        age_minutes: 30,
        action_label: '状況を見る →',
        action_href: '/workflow',
      },
    ],
    carryover_count: 2,
    team_capacity: [
      {
        user_id: 'user_1',
        name: '山田 太郎',
        role_label: '薬',
        status: 'working',
        slack_minutes: 11,
        busy_ratio: 0.94,
      },
      {
        user_id: 'user_2',
        name: '佐藤 恵',
        role_label: '薬',
        status: 'working',
        slack_minutes: 70,
        busy_ratio: 0.6,
      },
      {
        user_id: 'user_3',
        name: '鈴木 さくら',
        role_label: '事務',
        status: 'working',
        slack_minutes: 120,
        busy_ratio: 0.2,
      },
      {
        user_id: 'user_4',
        name: '田中 真',
        role_label: '事務',
        status: 'off',
        slack_minutes: null,
        busy_ratio: null,
      },
    ],
  };
}

type SegmentQueryState<TData> = {
  data: TData | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetchError?: boolean;
  error: Error | null;
  refetch: typeof refetchMock;
};

function buildSummaryFixture(data = buildFixture()): DashboardCockpitSummaryResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    cycle_status_counts: data.cycle_status_counts,
    audit_queue_total_count: data.audit_queue_total_count,
    audit_pending_count: data.audit_pending_count,
    narcotic_audit_count: data.narcotic_audit_count,
    earliest_audit_due_at:
      data.audit_queue
        .map((item) => item.due_at)
        .filter((dueAt): dueAt is string => dueAt != null)
        .sort()[0] ?? null,
    today_visit_count: data.today_visits.length,
    today_visit_times: data.today_visits
      .filter((visit) => visit.time_start != null)
      .map((visit) => visit.time_start as string),
  };
}

function buildDetailsFixture(data = buildFixture()): DashboardCockpitDetailsResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    audit_queue_total_count: data.audit_queue_total_count,
    audit_queue_visible_count: data.audit_queue_visible_count,
    audit_queue_hidden_count: data.audit_queue_hidden_count,
    audit_queue: data.audit_queue,
    urgent_items: data.urgent_items ?? buildUrgentFixture(),
    urgent_total_count: data.urgent_total_count ?? 0,
    urgent_visible_count: data.urgent_visible_count ?? 0,
    urgent_hidden_count: data.urgent_hidden_count ?? 0,
    today_visits: data.today_visits,
    blocked_reasons: data.blocked_reasons,
    carryover_count: data.carryover_count,
  };
}

function buildTeamFixture(data = buildFixture()): DashboardCockpitTeamResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    team_capacity: data.team_capacity,
  };
}

function buildCommentsFixture(data = buildFixture()): DashboardCockpitCommentsResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    comments: [
      {
        id: 'comment_1',
        entity_type: 'medication_cycle',
        entity_id: 'cycle_1',
        entity_label: '処方サイクル',
        author_id: 'user_2',
        author_name: '鈴木 さくら',
        content_excerpt: '監査前に家族連絡の結果だけ確認してください。',
        mentions_me: true,
        authored_by_me: false,
        created_at: localIso(9, 20),
        href: '/patients/patient_1',
      },
      {
        id: 'comment_2',
        entity_type: 'care_report',
        entity_id: 'report_1',
        entity_label: '報告書',
        author_id: 'user_1',
        author_name: '山田 太郎',
        content_excerpt: '報告書の送付先を確認済みです。',
        mentions_me: false,
        authored_by_me: true,
        created_at: localIso(9, 10),
        href: '/reports/report_1',
      },
    ],
    comments_total_count: 4,
    comments_visible_count: 2,
    comments_hidden_count: 2,
  };
}

function buildInboundFixture(data = buildFixture()): DashboardCockpitInboundResponse {
  return {
    generated_at: data.generated_at,
    scope: data.scope,
    inbound_items: [
      {
        id: 'inbound_communication:event_1',
        event_id: 'event_1',
        channel: 'mcs',
        channel_label: 'MCS',
        event_type: 'medication_stock_report',
        processing_status: 'signals_extracted',
        status: 'needs_review',
        priority: 'urgent',
        patient_id: 'patient_1',
        patient_name: '田中 一郎',
        sender_name: '山田 花子',
        sender_role: 'nurse',
        sender_organization_name: '訪問看護ステーションA',
        sender_contact: '090-0000-0000',
        title: 'MCS受信: 安全確認が必要',
        summary: '湿布残数4枚と使用増加の報告',
        raw_text: '湿布は残り4枚です。痛みが強く使用頻度が増えています。',
        normalized_summary: '湿布残数4枚と使用増加の報告',
        received_at: localIso(9, 18),
        occurred_at: localIso(9, 10),
        due_at: localIso(9, 18),
        attachment_count: 1,
        has_medication_stock_signal: true,
        has_patient_safety_signal: true,
        has_schedule_signal: false,
        has_report_signal: true,
        action_href: '/patients/patient_1#inbound-communications',
        action_label: '受信情報を確認',
        signals: [
          {
            id: 'signal_1',
            signal_domain: 'medication_stock',
            signal_type: 'observed_quantity',
            extracted_text: '湿布は残り4枚',
            extracted_medication_name: '湿布',
            extracted_quantity: 4,
            extracted_unit: 'sheet',
            review_status: 'needs_review',
            action_status: 'not_linked',
            source_confidence: 'text_parsed_high',
          },
        ],
      },
    ],
    inbound_total_count: 3,
    inbound_visible_count: 1,
    inbound_hidden_count: 2,
    inbound_needs_review_count: 1,
    inbound_reviewed_pending_action_count: 0,
    inbound_urgent_count: 1,
    inbound_medication_stock_signal_count: 1,
    inbound_safety_signal_count: 1,
  };
}

function successQuery<TData>(data: TData): SegmentQueryState<TData> {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchMock,
  };
}

function mockDashboardQueries({
  fixture = buildFixture(),
  summary,
  details,
  team,
  comments,
  inbound,
}: {
  fixture?: DashboardCockpitResponse;
  summary?: Partial<SegmentQueryState<DashboardCockpitSummaryResponse>>;
  details?: Partial<SegmentQueryState<DashboardCockpitDetailsResponse>>;
  team?: Partial<SegmentQueryState<DashboardCockpitTeamResponse>>;
  comments?: Partial<SegmentQueryState<DashboardCockpitCommentsResponse>>;
  inbound?: Partial<SegmentQueryState<DashboardCockpitInboundResponse>>;
} = {}) {
  const states = {
    summary: { ...successQuery(buildSummaryFixture(fixture)), ...summary },
    details: { ...successQuery(buildDetailsFixture(fixture)), ...details },
    team: { ...successQuery(buildTeamFixture(fixture)), ...team },
    comments: { ...successQuery(buildCommentsFixture(fixture)), ...comments },
    inbound: { ...successQuery(buildInboundFixture(fixture)), ...inbound },
  };

  useRealtimeQueryMock.mockImplementation((config: { queryKey: unknown[] }) => {
    const segment = config.queryKey[2];
    if (segment === 'summary') return states.summary;
    if (segment === 'details') return states.details;
    if (segment === 'team') return states.team;
    if (segment === 'comments') return states.comments;
    if (segment === 'inbound') return states.inbound;
    return successQuery(fixture);
  });
}

function queryConfigFor(
  segment: 'summary' | 'details' | 'team' | 'comments' | 'inbound',
  scope: 'mine' | 'team' = 'mine',
) {
  return useRealtimeQueryMock.mock.calls
    .map(
      (call) =>
        call[0] as {
          queryKey: unknown[];
          queryFn: () => Promise<unknown>;
          invalidateOn?: readonly unknown[];
        },
    )
    .find((config) => config.queryKey[2] === segment && config.queryKey[4] === scope);
}

describe('DashboardCockpit', () => {
  beforeEach(() => {
    useUIStore.setState({ workspaceRailOpen: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 12, 9, 42));
    refetchMock.mockClear();
    mockDashboardQueries();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the page header row with the scope toggle', () => {
    render(<DashboardCockpit />);

    expect(screen.getByRole('heading', { name: 'ダッシュボード' })).toBeTruthy();
    expect(screen.getByText(/6\/12\(金\) 09:42 — 私の今日/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '私の今日' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'チーム全体' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('fetches cockpit data with shared org headers and stable scope query keys', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = stubJsonFetch({ data: buildFixture() });

    render(<DashboardCockpit />);

    const mineSummaryConfig = queryConfigFor('summary');
    const mineDetailsConfig = queryConfigFor('details');
    const mineTeamConfig = queryConfigFor('team');
    const mineCommentsConfig = queryConfigFor('comments');
    const mineInboundConfig = queryConfigFor('inbound');
    expect(mineSummaryConfig?.queryKey).toEqual([
      'dashboard',
      'cockpit',
      'summary',
      'org_1',
      'mine',
    ]);
    expect(mineDetailsConfig?.queryKey).toEqual([
      'dashboard',
      'cockpit',
      'details',
      'org_1',
      'mine',
    ]);
    expect(mineTeamConfig?.queryKey).toEqual(['dashboard', 'cockpit', 'team', 'org_1', 'mine']);
    expect(mineCommentsConfig?.queryKey).toEqual([
      'dashboard',
      'cockpit',
      'comments',
      'org_1',
      'mine',
    ]);
    expect(mineInboundConfig?.queryKey).toEqual([
      'dashboard',
      'cockpit',
      'inbound',
      'org_1',
      'mine',
    ]);
    expect(mineSummaryConfig?.invalidateOn).not.toContain('workflow_refresh');
    expect(mineSummaryConfig?.invalidateOn).toEqual([
      'cycle_transition',
      expect.objectContaining({
        type: 'workflow_refresh',
        source: expect.arrayContaining([
          'medication_cycles_transition',
          'prescription_intakes_create',
          'visit_schedules_update',
          'visit_schedule_proposals_create',
          'set_batches_update',
        ]),
      }),
    ]);
    expect(mineSummaryConfig?.invalidateOn).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: ['inbound_communications_update', 'inbound_signal_update'],
        }),
      ]),
    );
    expect(mineDetailsConfig?.invalidateOn).toEqual([
      'cycle_transition',
      expect.objectContaining({
        type: 'workflow_refresh',
        source: expect.arrayContaining([
          'dispense_audits',
          'dispense_tasks_update',
          'visit_schedules_update',
        ]),
      }),
      expect.objectContaining({
        type: 'workflow_refresh',
        source: ['inbound_communications_update', 'inbound_signal_update'],
      }),
    ]);
    expect(mineTeamConfig?.invalidateOn).toEqual([
      expect.objectContaining({
        type: 'workflow_refresh',
        source: expect.arrayContaining([
          'visit_schedules_update',
          'visit_schedules_reorder',
          'facility_visit_batches_upsert',
          'pharmacist_shifts_update',
        ]),
      }),
    ]);
    expect(mineTeamConfig?.invalidateOn).not.toEqual(expect.arrayContaining(['cycle_transition']));
    expect(mineTeamConfig?.invalidateOn).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.arrayContaining(['dispense_audits', 'inbound_signal_update']),
        }),
      ]),
    );
    expect(mineCommentsConfig?.invalidateOn).toEqual(['comment_refresh']);
    expect(mineInboundConfig?.invalidateOn).toEqual([
      expect.objectContaining({
        type: 'workflow_refresh',
        source: ['inbound_communications_update', 'inbound_signal_update'],
      }),
    ]);

    await mineSummaryConfig?.queryFn();
    await mineDetailsConfig?.queryFn();
    await mineTeamConfig?.queryFn();
    await mineCommentsConfig?.queryFn();
    await mineInboundConfig?.queryFn();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/dashboard/cockpit/summary?scope=mine');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/dashboard/cockpit/details?scope=mine');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/dashboard/cockpit/team?scope=mine');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/dashboard/cockpit/comments?scope=mine');
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/dashboard/cockpit/inbound?scope=mine');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toBe(sentinelHeaders);

    fireEvent.click(screen.getByRole('button', { name: 'チーム全体' }));
    const teamSummaryConfig = queryConfigFor('summary', 'team');
    expect(teamSummaryConfig?.queryKey).toEqual([
      'dashboard',
      'cockpit',
      'summary',
      'org_1',
      'team',
    ]);

    fetchMock.mockClear();
    await teamSummaryConfig?.queryFn();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/dashboard/cockpit/summary?scope=team');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledTimes(6);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(1, 'org_1');
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(2, 'org_1');
  });

  it('disables the team scope when the API applies mine-only dashboard access', () => {
    mockDashboardQueries({
      fixture: {
        ...buildFixture(),
        scope: { requested: 'team', applied: 'mine', can_view_team: false },
      },
    });

    render(<DashboardCockpit />);

    expect(
      screen.getByText(
        'この画面は担当患者・担当ケースの範囲で集計しています。チーム全体の集計は管理者だけが表示できます。',
      ),
    ).toBeTruthy();
    expect((screen.getByRole('button', { name: 'チーム全体' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('renders the condition banner with bold counts and deadline', () => {
    render(<DashboardCockpit />);

    const banner = screen.getByTestId('dashboard-condition-banner');
    expect(within(banner).getByText('条件つきで回る')).toBeTruthy();
    expect(within(banner).getByText('監査6件')).toBeTruthy();
    expect(within(banner).getByText('(麻薬1件を含む)')).toBeTruthy();
    expect(within(banner).getByText('12:00までに')).toBeTruthy();
    expect(within(banner).getByText('訪問2件')).toBeTruthy();
    expect(within(banner).getByText('根拠を見る →')).toBeTruthy();
  });

  it('renders 今すぐ対応 cards with hazard tags and a single primary action', () => {
    render(<DashboardCockpit />);

    const section = screen.getByTestId('dashboard-urgent-now');
    expect(within(section).getByRole('heading', { name: '今すぐ対応', level: 2 })).toBeTruthy();
    expect(within(section).getByText('今すぐ対応')).toBeTruthy();
    expect(within(section).getByText('表示 3/8件')).toBeTruthy();
    expect(within(section).getByText('全8件のうち、期限が近い3件を表示しています。')).toBeTruthy();

    const cards = within(section).getAllByTestId('dashboard-urgent-card');
    expect(cards).toHaveLength(3);

    // 1枚目: 麻薬監査(危険タグを隠さない)+ 期限カウントダウン + 主操作(青)は 1 つ
    expect(within(cards[0]).getByText('田中 一郎 様')).toBeTruthy();
    expect(within(cards[0]).getByText('麻薬監査')).toBeTruthy();
    expect(within(cards[0]).getByText('麻薬')).toBeTruthy();
    expect(within(cards[0]).getByText('冷所')).toBeTruthy();
    expect(within(cards[0]).getByText('RX-2024-0500')).toBeTruthy();
    expect(within(cards[0]).getByText('期限 12:00 — あと 2時間18分')).toBeTruthy();
    expect(within(section).getAllByRole('link', { name: '監査を開始する' })).toHaveLength(1);

    // 2枚目: 他職種受信も監査と同じ urgent queue に並ぶ
    expect(within(cards[1]).getByText('MCS')).toBeTruthy();
    expect(within(cards[1]).getByText('安全確認')).toBeTruthy();
    expect(within(cards[1]).getByText('湿布 / 4sheet / 湿布は残り4枚')).toBeTruthy();
    expect(within(cards[1]).getByRole('link', { name: '受信情報を確認' })).toBeTruthy();

    // 3枚目: WorkflowException 由来の詰まりも task source として並ぶ
    expect(within(cards[2]).getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(within(cards[2]).getByText('止まっている理由')).toBeTruthy();
    expect(within(cards[2]).getAllByText('患者').length).toBeGreaterThan(0);
    expect(within(cards[2]).getByText('重大')).toBeTruthy();
    expect(within(cards[2]).getByRole('link', { name: '再連絡する' })).toBeTruthy();
  });

  it('keeps urgent safety cues in the main body when the auxiliary panel is closed', () => {
    useUIStore.setState({ workspaceRailOpen: false });

    render(<DashboardCockpit />);

    expect(screen.queryByTestId('next-action-panel')).toBeNull();

    const section = screen.getByTestId('dashboard-urgent-now');
    const primaryCard = within(section).getAllByTestId('dashboard-urgent-card')[0];
    expect(within(primaryCard).getByText('田中 一郎 様')).toBeTruthy();
    expect(within(primaryCard).getByText('麻薬監査')).toBeTruthy();
    expect(within(primaryCard).getByText('麻薬')).toBeTruthy();
    expect(within(primaryCard).getByText('冷所')).toBeTruthy();
    expect(within(primaryCard).getByText('期限 12:00 — あと 2時間18分')).toBeTruthy();
    expect(within(section).getByRole('link', { name: '監査を開始する' })).toBeTruthy();
  });

  it('renders the today flow timeline with locked visits, desk work, and the now marker', () => {
    render(<DashboardCockpit />);

    const section = screen.getByTestId('dashboard-today-flow');
    expect(within(section).getByRole('heading', { name: '今日の流れ', level: 2 })).toBeTruthy();
    expect(within(section).getByText('今日の流れ')).toBeTruthy();
    expect(within(section).getByText('監査 6件(麻薬を先頭)')).toBeTruthy();
    expect(within(section).getByText('伊藤様')).toBeTruthy();
    expect(within(section).getByText('田中様')).toBeTruthy();
    expect(within(section).getByText('昼休み')).toBeTruthy();
    expect(within(section).getByText(/報告書 11件/)).toBeTruthy();
    expect(within(section).getByText('いま 09:42')).toBeTruthy();
    expect(within(section).getByRole('link', { name: '→ スケジュールへ' })).toBeTruthy();
  });

  it('renders 工程の今 with 9 process tiles, WIP guides, and the bottleneck note', () => {
    render(<DashboardCockpit />);

    const section = screen.getByTestId('dashboard-process-now');
    expect(within(section).getByRole('heading', { name: '工程の今', level: 2 })).toBeTruthy();
    for (const label of [
      '取込',
      '入力',
      '判断',
      '調剤',
      '監査',
      'セット',
      '訪問',
      '報告',
      '算定',
    ]) {
      expect(within(section).getByText(label)).toBeTruthy();
    }
    // 監査 = dispensed(10) + audit_pending(14)
    expect(within(section).getByText('24')).toBeTruthy();
    expect(within(section).getByText('目安14')).toBeTruthy();
    expect(
      within(section).getByText(
        '詰まりは判断と監査。上流の工程を今増やしても、今日は速くなりません。',
      ),
    ).toBeTruthy();
    expect(within(section).getByRole('link', { name: '→ ハンドオフで再配分' })).toBeTruthy();
  });

  it('renders チームの余白 with slack tones, off member, and the handoff suggestion', () => {
    render(<DashboardCockpit />);

    const section = screen.getByTestId('dashboard-team-capacity');
    expect(within(section).getByRole('heading', { name: 'チームの余白', level: 2 })).toBeTruthy();
    expect(within(section).getByText('チームの余白')).toBeTruthy();
    expect(within(section).getByText('山田(薬)')).toBeTruthy();
    expect(within(section).getByText(/余白 11分/)).toBeTruthy();
    expect(within(section).getByText(/余白 120分/)).toBeTruthy();
    expect(within(section).getByText('田中(事務)')).toBeTruthy();
    expect(within(section).getByText('休み')).toBeTruthy();
    // 監査(dispensed 10 + audit_pending 14 = 24, 目安14)が最大超過 → 余白最大の鈴木へ
    expect(within(section).getByText('監査キュー定型10件を鈴木さんへ回せます')).toBeTruthy();
    expect(within(section).getByRole('link', { name: '→ ハンドオフへ' })).toBeTruthy();
  });

  it('renders the action rail with next action, blockers, evidence, and team conversation', () => {
    render(<DashboardCockpit />);

    const nextAction = screen.getByTestId('next-action-panel');
    expect(within(nextAction).getByText('次にやること')).toBeTruthy();
    expect(
      within(nextAction).getByRole('link', { name: '麻薬監査を開始 — 12:00期限' }),
    ).toBeTruthy();

    const blocked = screen.getByTestId('blocked-reasons-panel');
    expect(within(blocked).getByText('止まっている理由')).toBeTruthy();
    expect(within(blocked).getByText('患者')).toBeTruthy();
    expect(within(blocked).getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(within(blocked).getByText('1日')).toBeTruthy();
    expect(within(blocked).getByText('再連絡する →')).toBeTruthy();
    expect(within(blocked).getByText('30分')).toBeTruthy();

    const evidence = screen.getByTestId('evidence-panel');
    expect(within(evidence).getByText('根拠・記録')).toBeTruthy();
    expect(within(evidence).getByText('今朝の同期')).toBeTruthy();
    expect(within(evidence).getByText('09:42')).toBeTruthy();
    expect(within(evidence).getByText('昨日からの持ち越し')).toBeTruthy();
    expect(within(evidence).getByText('2件')).toBeTruthy();
    expect(within(evidence).getAllByRole('button', { name: /開く/ }).length).toBeGreaterThan(0);

    // デザイン 01: 右レールは 3 点セットのみ。「私の今日」リストカードは置かない
    expect(screen.queryByTestId('dashboard-my-today')).toBeNull();

    const inbound = screen.getByTestId('dashboard-inbound-panel');
    expect(within(inbound).getByRole('heading', { name: '他職種受信', level: 3 })).toBeTruthy();
    expect(within(inbound).getByText('確認待ち 1件')).toBeTruthy();
    expect(within(inbound).getByText('MCS')).toBeTruthy();
    expect(within(inbound).getByText('安全確認')).toBeTruthy();
    expect(within(inbound).getByText('田中 一郎 様')).toBeTruthy();
    expect(
      within(inbound).getByText('湿布は残り4枚です。痛みが強く使用頻度が増えています。'),
    ).toBeTruthy();
    expect(within(inbound).getByText('湿布 4sheet')).toBeTruthy();
    expect(within(inbound).getByText('nurse / 山田 花子 / 訪問看護ステーションA')).toBeTruthy();
    expect(within(inbound).getByRole('link', { name: '受信情報を確認' })).toBeTruthy();
    expect(within(inbound).getByText('他2件は受信インボックスで確認できます。')).toBeTruthy();

    const comments = screen.getByTestId('dashboard-comments-panel');
    expect(within(comments).getByRole('heading', { name: 'チームの会話', level: 3 })).toBeTruthy();
    expect(within(comments).getByText('自分宛')).toBeTruthy();
    expect(within(comments).getByText('処方サイクル')).toBeTruthy();
    expect(within(comments).getByText('監査前に家族連絡の結果だけ確認してください。')).toBeTruthy();
    expect(within(comments).getByText('自分の投稿')).toBeTruthy();
    expect(within(comments).getByText('報告書')).toBeTruthy();
    expect(within(comments).getByText('他2件はハンドオフで確認できます。')).toBeTruthy();
    expect(within(comments).getByRole('link', { name: 'すべて見る' })).toBeTruthy();
    expect(within(comments).getAllByRole('link', { name: '開く' })).toHaveLength(2);
  });

  it('marks cockpit evidence as stale when the generated snapshot is older than the realtime freshness window', () => {
    mockDashboardQueries({
      fixture: {
        ...buildFixture(),
        generated_at: localIso(9, 40),
      },
    });

    render(<DashboardCockpit />);

    const evidence = screen.getByTestId('evidence-panel');
    expect(within(evidence).getByText('09:40 / 要更新')).toBeTruthy();
  });

  it('updates the cockpit evidence freshness label as time passes without a refetch', () => {
    render(<DashboardCockpit />);

    const evidence = screen.getByTestId('evidence-panel');
    expect(within(evidence).getByText('09:42')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(within(evidence).getByText('09:42 / 要更新')).toBeTruthy();
  });

  it('does not render NaN for malformed cockpit evidence timestamps', () => {
    expect(formatCockpitGeneratedAtMeta('not-a-date', new Date('2026-06-12T00:00:00.000Z'))).toBe(
      '—',
    );
    expect(formatCockpitGeneratedAtMeta(localIso(9, 43), new Date(2026, 5, 12, 9, 42))).toBe(
      '09:43',
    );

    mockDashboardQueries({
      fixture: {
        ...buildFixture(),
        generated_at: 'not-a-date',
      },
    });

    render(<DashboardCockpit />);

    const evidence = screen.getByTestId('evidence-panel');
    expect(within(evidence).getByText('—')).toBeTruthy();
    expect(evidence.textContent).not.toContain('NaN');
  });

  it('shows the error state with retry when the cockpit fetch fails', () => {
    mockDashboardQueries({
      summary: {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('boom'),
      },
    });

    render(<DashboardCockpit />);

    expect(screen.getByText('ダッシュボードを表示できません')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalled();
  });

  it('keeps stale cockpit data visible and shows a retry warning when a background refetch fails', () => {
    mockDashboardQueries({
      summary: {
        isError: true,
        isRefetchError: true,
        error: new Error('background refresh failed'),
      },
    });

    render(<DashboardCockpit />);

    expect(screen.getByRole('heading', { name: 'ダッシュボード' })).toBeTruthy();
    const primaryCard = within(screen.getByTestId('dashboard-urgent-now')).getAllByTestId(
      'dashboard-urgent-card',
    )[0];
    expect(within(primaryCard).getByText('田中 一郎 様')).toBeTruthy();
    expect(
      screen.getByText('最新化に失敗しました。表示中の情報は前回取得時点のものです。'),
    ).toBeTruthy();
    expect(screen.queryByText('ダッシュボードを表示できません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalledTimes(5);
  });

  it('keeps summary sections visible when details fail before the first payload arrives', () => {
    mockDashboardQueries({
      details: {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('details down'),
      },
    });

    render(<DashboardCockpit />);

    expect(screen.getByTestId('dashboard-condition-banner')).toBeTruthy();
    expect(screen.getByTestId('dashboard-process-now')).toBeTruthy();
    expect(screen.getByText('対応詳細を表示できません')).toBeTruthy();
    expect(
      screen.queryByText('いま期限・待ち解除で対応が必要な処方サイクルはありません。'),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps process status visible when team capacity fails before the first payload arrives', () => {
    mockDashboardQueries({
      team: {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('team down'),
      },
    });

    render(<DashboardCockpit />);

    expect(screen.getByTestId('dashboard-process-now')).toBeTruthy();
    expect(screen.getByText('チーム状況を表示できません')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-team-capacity')).toBeNull();
  });

  it('keeps the action rail visible when the conversation feed fails before the first payload arrives', () => {
    mockDashboardQueries({
      comments: {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('comments down'),
      },
    });

    render(<DashboardCockpit />);

    expect(screen.getByTestId('next-action-panel')).toBeTruthy();
    expect(screen.getByText('チームの会話を表示できません')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
