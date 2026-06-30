// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { useUIStore } from '@/lib/stores/ui-store';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type {
  DayBoardStaff,
  ScheduleDayBoardOperationalTask,
  ScheduleDayBoardResponse,
} from '@/types/schedule-day-board';
import {
  buildScheduleRiskAlert,
  buildStaffLane,
  pendingProposalDateLabel,
  staffRowLabel,
} from './schedule-team-board.helpers';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const buildOrgHeadersMock = vi.hoisted(() => vi.fn());
const buildOrgJsonHeadersMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/api/org-headers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: buildOrgHeadersMock,
    buildOrgJsonHeaders: buildOrgJsonHeadersMock,
  };
});

import { ScheduleTeamBoard } from './schedule-team-board';

setupDomTestEnv();

const READY_PREPARATION_SUMMARY = {
  completed_count: 5,
  total_count: 5,
  status: 'ready' as const,
  incomplete_labels: [],
};

function dateKeyOf(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

const TODAY_KEY = dateKeyOf(new Date());
const TOMORROW_KEY = dateKeyOf(new Date(Date.now() + 24 * 60 * 60 * 1000));

function localIso(hours: number, minutes = 0) {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function clockIso(hours: number, minutes = 0) {
  const today = new Date();
  // @db.Time values are encoded as UTC clock sentinels; business days still use JST/local keys.
  return new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hours, minutes, 0, 0),
  ).toISOString();
}

function buildPharmacist(overrides: Partial<DayBoardStaff> = {}): DayBoardStaff {
  return {
    id: 'user_yamada',
    name: '山田 太郎',
    role: 'pharmacist',
    role_kind: 'pharmacist',
    visits: [
      {
        id: 'visit_1',
        patient_name: '伊藤 キヨ',
        visit_type: 'regular',
        schedule_status: 'planned',
        priority: 'normal',
        site_id: 'site_1',
        route_order: 1,
        time_start: clockIso(10, 30),
        time_end: clockIso(11, 15),
        vehicle_resource_id: 'vehicle_1',
        vehicle_label: '軽バン1号',
        vehicle_travel_mode: 'DRIVE',
        confirmed: true,
        facility_label: null,
        facility_batch_id: null,
        facility_patient_count: 1,
        preparation_summary: {
          completed_count: 2,
          total_count: 5,
          status: 'incomplete',
          incomplete_labels: ['薬歴・前回変更の確認', '持参薬・物品確認', 'ルート確認'],
        },
      },
      {
        id: 'visit_2',
        patient_name: '田中 一郎',
        visit_type: 'regular',
        schedule_status: 'ready',
        priority: 'normal',
        site_id: 'site_1',
        route_order: 2,
        time_start: clockIso(14, 0),
        time_end: clockIso(14, 45),
        vehicle_resource_id: 'vehicle_1',
        vehicle_label: '軽バン1号',
        vehicle_travel_mode: 'DRIVE',
        confirmed: true,
        facility_label: null,
        facility_batch_id: null,
        facility_patient_count: 1,
        preparation_summary: {
          ...READY_PREPARATION_SUMMARY,
          ready_blocker_summary: {
            blocked: true,
            blocker_count: 2,
            category_labels: ['導入準備 2件'],
            preparation_blocker_count: 0,
            onboarding_blocker_count: 2,
            billing_blocker_count: 0,
          },
        },
      },
      {
        id: 'visit_3',
        patient_name: '中村 ヨシ',
        visit_type: 'regular',
        schedule_status: 'completed',
        priority: 'normal',
        site_id: 'site_1',
        route_order: 3,
        time_start: clockIso(15, 30),
        time_end: clockIso(17, 0),
        vehicle_resource_id: null,
        vehicle_label: null,
        vehicle_travel_mode: null,
        confirmed: true,
        facility_label: 'グリーンヒル',
        facility_batch_id: 'batch_green',
        facility_patient_count: 12,
        preparation_summary: READY_PREPARATION_SUMMARY,
      },
      {
        id: 'visit_5',
        patient_name: '施設 二郎',
        visit_type: 'regular',
        schedule_status: 'planned',
        priority: 'normal',
        site_id: 'site_1',
        route_order: 4,
        time_start: clockIso(16, 0),
        time_end: clockIso(16, 30),
        vehicle_resource_id: 'vehicle_1',
        vehicle_label: '軽バン1号',
        vehicle_travel_mode: 'DRIVE',
        confirmed: true,
        facility_label: 'グリーンヒル',
        facility_batch_id: 'batch_green',
        facility_patient_count: 12,
        preparation_summary: {
          completed_count: 4,
          total_count: 5,
          status: 'blocked',
          incomplete_labels: ['持参物ステータス未解決'],
        },
      },
    ],
    open_task_count: 2,
    audit_task_count: 6,
    ...overrides,
  };
}

function buildClerk(): DayBoardStaff {
  return {
    id: 'user_suzuki',
    name: '鈴木 花',
    role: 'clerk',
    role_kind: 'clerk',
    visits: [],
    open_task_count: 4,
    audit_task_count: 0,
  };
}

function buildBoardFixture(): ScheduleDayBoardResponse {
  const pharmacist = buildPharmacist();
  return {
    generated_at: localIso(9, 40),
    date: TODAY_KEY,
    staff: [
      {
        ...pharmacist,
        visits: [
          ...pharmacist.visits,
          {
            id: 'visit_4',
            patient_name: '岡田 健',
            visit_type: 'temporary',
            schedule_status: 'planned',
            priority: 'normal',
            site_id: 'site_1',
            route_order: null,
            time_start: clockIso(17, 15),
            time_end: clockIso(17, 45),
            vehicle_resource_id: null,
            vehicle_label: null,
            vehicle_travel_mode: null,
            confirmed: false,
            facility_label: null,
            facility_batch_id: null,
            facility_patient_count: 1,
            preparation_summary: {
              completed_count: 5,
              total_count: 5,
              status: 'blocked',
              incomplete_labels: ['持参物ステータス未解決'],
            },
          },
        ],
      },
      buildClerk(),
    ],
    audit_pending_count: 6,
    report_pending_count: 2,
    staff_counts: {
      total_count: 2,
      visible_count: 2,
      hidden_count: 0,
      total_visit_count: 5,
      visible_visit_count: 5,
      hidden_visit_count: 0,
      total_preparation_attention_count: 4,
      visible_preparation_attention_count: 4,
      hidden_preparation_attention_count: 0,
      hidden_operational_task_count: 0,
      limit: 6,
    },
    vehicle_resources: [
      {
        id: 'vehicle_1',
        label: '軽バン1号',
        site_id: 'site_1',
        vehicle_code: 'VEH-DEMO-001',
        travel_mode: 'DRIVE',
        available: true,
        max_stops: 8,
        max_route_duration_minutes: 180,
        assigned_visit_count: 2,
        remaining_stops: 6,
        route_duration_minutes: 42,
        route_duration_status: 'within_limit',
        route_duration_label: '稼働 42分 / 上限 180分',
        recommended: true,
        recommendation_reason: '未割当 1件を受けられます',
      },
      {
        id: 'vehicle_2',
        label: '軽バン2号',
        site_id: 'site_1',
        vehicle_code: 'VEH-DEMO-002',
        travel_mode: 'DRIVE',
        available: true,
        max_stops: 4,
        max_route_duration_minutes: null,
        assigned_visit_count: 0,
        remaining_stops: 4,
        route_duration_minutes: null,
        route_duration_status: 'not_limited',
        route_duration_label: '稼働上限なし',
        recommended: false,
        recommendation_reason: '空き 4件',
      },
    ],
    pending_proposals: [
      {
        id: 'proposal_1',
        patient_name: '鈴木 新',
        pharmacist_name: '佐藤 真',
        patient_contact_status: 'pending',
        proposed_date: TOMORROW_KEY,
        time_start: clockIso(10, 0),
        badge_label: '受入判断',
        response_due_at: localIso(17, 0),
        idle_before_minutes: 70,
        idle_after_minutes: 25,
      },
    ],
    pending_proposal_counts: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      limit: 3,
      hidden_operational_task_count: 0,
    },
    operational_tasks: [
      buildScheduleTask(),
      buildScheduleTask({
        id: 'task_outside',
        title: '翌日の準備',
        related_entity_id: 'visit_outside',
      }),
    ],
  };
}

function buildCockpitFixture(): DashboardCockpitResponse {
  return {
    generated_at: localIso(9, 42),
    cycle_status_counts: {},
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
        handling_tags: ['narcotic'],
        has_narcotic: true,
        waiting_since: localIso(8, 0),
      },
    ],
    today_visits: [],
    blocked_reasons: [
      {
        id: 'exception_1',
        label: 'ご家族の同意待ち(新規契約)',
        severity: 'warning',
        category: '患者',
        age_minutes: 24 * 60,
        action_label: '再連絡する →',
        action_href: '/communications/requests',
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
    carryover_count: 1,
    team_capacity: [],
  };
}

function buildScheduleTask(
  overrides: Partial<ScheduleDayBoardOperationalTask> = {},
): ScheduleDayBoardOperationalTask {
  return {
    id: 'task_preparation',
    task_type: 'visit_preparation',
    title: '訪問準備を確認してください',
    description: '出発前に持参薬とルートを確認します',
    status: 'pending',
    priority: 'high',
    assigned_to: 'user_yamada',
    due_date: localIso(11, 0),
    sla_due_at: null,
    related_entity_type: 'visit_schedule',
    related_entity_id: 'visit_1',
    metadata: null,
    created_at: localIso(8, 30),
    ...overrides,
  };
}

type QueryConfig = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
};

type MutationConfig<TPayload = unknown> = {
  mutationFn: (payload: TPayload) => Promise<unknown>;
};

type VisitStatusPayload = {
  scheduleId: string;
  status: 'in_progress';
};

type TaskStatusPayload = {
  taskId: string;
  status: 'in_progress';
};

function findQueryConfig(
  configs: readonly QueryConfig[],
  matcher: (queryKey: readonly unknown[]) => boolean,
): QueryConfig {
  const config = configs.find((candidate) => matcher(candidate.queryKey));
  if (!config) {
    throw new Error('Query config was not captured');
  }
  return config;
}

function buildJsonResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockQueries({
  board = buildBoardFixture(),
  cockpit = buildCockpitFixture(),
  onQueryConfig,
}: {
  board?: ScheduleDayBoardResponse | null;
  cockpit?: DashboardCockpitResponse | null;
  onQueryConfig?: (config: QueryConfig) => void;
} = {}) {
  useQueryMock.mockImplementation((options: QueryConfig) => {
    onQueryConfig?.(options);
    const key = options.queryKey[0];
    if (key === 'schedule-day-board') {
      return { data: board, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: cockpit, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  });
}

describe('buildStaffLane', () => {
  it('builds pharmacist lane with visit blocks, desk audit block, lunch and idle total', () => {
    const lane = buildStaffLane({
      staff: buildPharmacist(),
      riskPatientNames: new Set(['田中 一郎']),
      reportPendingCount: 2,
    });

    expect(lane.rowLabel).toBe('山田(薬)');
    const visitBlocks = lane.blocks.filter((block) => block.kind === 'visit');
    expect(visitBlocks).toHaveLength(3);
    expect(visitBlocks.map((block) => block.label)).toContain('施設グリーンヒル 12名');
    expect(visitBlocks.every((block) => block.locked)).toBe(true);
    expect(visitBlocks.find((block) => block.label === '田中 一郎様')?.risk).toBe(true);
    expect(visitBlocks.find((block) => block.label === '伊藤 キヨ様')?.preparationSummary).toEqual({
      completed_count: 2,
      total_count: 5,
      status: 'incomplete',
      incomplete_labels: ['薬歴・前回変更の確認', '持参薬・物品確認', 'ルート確認'],
    });
    const facilityBlock = visitBlocks.find((block) => block.label === '施設グリーンヒル 12名');
    expect(facilityBlock?.status).toBeNull();
    expect(facilityBlock?.aggregateScheduleIds).toEqual(['visit_3', 'visit_5']);
    expect(facilityBlock?.preparationSummary).toMatchObject({
      status: 'blocked',
      aggregate_visit_count: 2,
      incomplete_visit_count: 1,
      blocked_visit_count: 1,
      incomplete_labels: ['持参物ステータス未解決'],
    });

    const deskLabels = lane.blocks
      .filter((block) => block.kind === 'desk')
      .map((block) => block.label);
    expect(deskLabels).toContain('監査6件');
    expect(deskLabels).toContain('報告');
    expect(lane.blocks.some((block) => block.kind === 'break')).toBe(true); // 訪問が昼と重ならないため昼休みを置く
    expect(lane.blocks.some((block) => block.kind === 'travel')).toBe(true);
    expect(lane.blocks.some((block) => block.kind === 'idle')).toBe(true);

    // 勤務帯9:00-18:00から占有分を引いた余白が件数として出る
    expect(lane.idleMinutes).toBeGreaterThan(0);
    expect(lane.idleMinutes).toBeLessThan(9 * 60);
    expect(lane.visitMinutes).toBe(180);
    expect(lane.travelMinutes).toBe(90);
    expect(lane.estimatedVisitSlots).toBe(Math.floor(lane.idleMinutes / 60));
  });

  it('aggregates facility visits with full-ready blockers as departure blockers', () => {
    const [baseVisit] = buildPharmacist().visits;
    const lane = buildStaffLane({
      staff: buildPharmacist({
        visits: [
          {
            ...baseVisit,
            id: 'facility_ready_blocked',
            patient_name: '施設 一郎',
            schedule_status: 'ready',
            facility_label: 'グリーンヒル',
            facility_batch_id: 'batch_ready_blocked',
            facility_patient_count: 2,
            preparation_summary: {
              ...READY_PREPARATION_SUMMARY,
              ready_blocker_summary: {
                blocked: true,
                blocker_count: 1,
                category_labels: ['導入準備 1件'],
                preparation_blocker_count: 0,
                onboarding_blocker_count: 1,
                billing_blocker_count: 0,
              },
            },
          },
          {
            ...baseVisit,
            id: 'facility_ready_clear',
            patient_name: '施設 二郎',
            schedule_status: 'ready',
            route_order: 2,
            facility_label: 'グリーンヒル',
            facility_batch_id: 'batch_ready_blocked',
            facility_patient_count: 2,
            preparation_summary: READY_PREPARATION_SUMMARY,
          },
        ],
      }),
    });

    const facilityBlock = lane.blocks.find((block) => block.label === '施設グリーンヒル 2名');
    expect(facilityBlock?.preparationSummary).toMatchObject({
      status: 'blocked',
      aggregate_visit_count: 2,
      incomplete_visit_count: 1,
      blocked_visit_count: 1,
      incomplete_labels: ['導入準備 1件'],
      ready_blocker_summary: {
        blocked: true,
        blocker_count: 1,
        category_labels: ['導入準備 1件'],
        preparation_blocker_count: 0,
        onboarding_blocker_count: 1,
        billing_blocker_count: 0,
      },
    });
  });

  it('builds clerk lane with routine desk blocks and clerical follow-up block', () => {
    const lane = buildStaffLane({ staff: buildClerk(), clericalBlockedCount: 1 });

    expect(lane.rowLabel).toBe('鈴木(事務)');
    const labels = lane.blocks.map((block) => block.label);
    expect(labels).toContain('窓口・取込');
    expect(labels).toContain('送付先確認ほか');
    expect(labels).toContain('入力・庶務');
    expect(labels).toContain('昼');
    expect(lane.idleMinutes).toBeGreaterThanOrEqual(120);
  });
});

describe('buildScheduleRiskAlert', () => {
  it('combines a narcotic audit deadline with the matching visit and facility fallback', () => {
    const alert = buildScheduleRiskAlert({
      auditQueue: buildCockpitFixture().audit_queue,
      staff: [buildPharmacist()],
    });

    expect(alert).not.toBeNull();
    expect(alert?.message).toContain('リスクのある予定: 14:00 田中 一郎様');
    expect(alert?.message).toContain('麻薬監査が未完了(期限12:00)');
    expect(alert?.message).toContain('訪問を15:00へ繰り下げ');
    expect(alert?.message).toContain('施設グリーンヒルを16:00開始に変更する案を準備済み');
    expect(alert?.actionHref).toBe('/audit');
  });

  it('returns null when no narcotic audit with deadline exists', () => {
    expect(buildScheduleRiskAlert({ auditQueue: [], staff: [buildPharmacist()] })).toBeNull();
  });
});

describe('pendingProposalDateLabel / staffRowLabel', () => {
  it('labels today and tomorrow relative to the board date', () => {
    expect(pendingProposalDateLabel('2026-06-12', '2026-06-12')).toBe('今日');
    expect(pendingProposalDateLabel('2026-06-13', '2026-06-12')).toBe('明日');
    expect(pendingProposalDateLabel('2026-06-20', '2026-06-12')).toBe('6/20');
  });

  it('builds row labels with role suffix', () => {
    expect(staffRowLabel({ name: '佐藤 真', role_kind: 'pharmacist' })).toBe('佐藤(薬)');
    expect(staffRowLabel({ name: '鈴木 花', role_kind: 'clerk' })).toBe('鈴木(事務)');
  });
});

describe('ScheduleTeamBoard', () => {
  beforeEach(() => {
    useUIStore.setState({ workspaceRailOpen: true });
    invalidateQueriesMock.mockReset();
    useMutationMock.mockReset();
    buildOrgHeadersMock.mockReset();
    buildOrgJsonHeadersMock.mockReset();
    toastErrorMock.mockReset();
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses shared org headers for schedule board queries while preserving raw query keys', async () => {
    const queryConfigs: QueryConfig[] = [];
    const orgHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    buildOrgHeadersMock.mockReturnValue(orgHeaders);
    mockQueries({ onQueryConfig: (config) => queryConfigs.push(config) });
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const boardConfig = findQueryConfig(
      queryConfigs,
      (queryKey) => queryKey[0] === 'schedule-day-board',
    );
    const cockpitConfig = findQueryConfig(
      queryConfigs,
      (queryKey) => queryKey[0] === 'schedule-rail-cockpit',
    );

    expect(boardConfig.queryKey).toEqual(['schedule-day-board', 'org_1', TODAY_KEY]);
    expect(cockpitConfig.queryKey).toEqual(['schedule-rail-cockpit', 'org_1']);
    expect(
      queryConfigs.some(
        (config) => config.queryKey[0] === 'tasks' && config.queryKey[1] === 'schedule-board',
      ),
    ).toBe(false);

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/visit-schedules/day-board')) {
        return buildJsonResponse(buildBoardFixture());
      }
      return buildJsonResponse(buildCockpitFixture());
    });
    vi.stubGlobal('fetch', fetchMock);

    await boardConfig.queryFn();
    await cockpitConfig.queryFn();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/visit-schedules/day-board?date=${TODAY_KEY}`);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toBe(orgHeaders);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/dashboard/cockpit');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toBe(orgHeaders);
    expect(buildOrgHeadersMock).toHaveBeenNthCalledWith(1, 'org_1');
    expect(buildOrgHeadersMock).toHaveBeenNthCalledWith(2, 'org_1');
  });

  it('encodes dynamic PATCH ids and preserves raw mutation payloads', async () => {
    const mutationConfigs: MutationConfig[] = [];
    const orgJsonHeaders = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    buildOrgJsonHeadersMock.mockReturnValue(orgJsonHeaders);
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return {
        mutate: vi.fn(),
        isPending: false,
        variables: undefined,
      };
    });
    mockQueries();
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const fetchMock = vi.fn<typeof fetch>(async () => buildJsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const scheduleId = 'schedule/1?x=y#z';
    const taskId = 'task/1?x=y#z';
    const statusMutation = mutationConfigs[0] as MutationConfig<VisitStatusPayload>;
    const taskStatusMutation = mutationConfigs[1] as MutationConfig<TaskStatusPayload>;

    await statusMutation.mutationFn({ scheduleId, status: 'in_progress' });
    await taskStatusMutation.mutationFn({ taskId, status: 'in_progress' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/visit-schedules/${encodeURIComponent(scheduleId)}`,
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('PATCH');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toBe(orgJsonHeaders);
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      schedule_status: 'in_progress',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/tasks/${encodeURIComponent(taskId)}`);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('PATCH');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toBe(orgJsonHeaders);
    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({
      status: 'in_progress',
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenNthCalledWith(1, 'org_1');
    expect(buildOrgJsonHeadersMock).toHaveBeenNthCalledWith(2, 'org_1');

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0])).join('\n');
    expect(calledUrls).not.toContain('/api/visit-schedules/schedule/1?x=y#z');
    expect(calledUrls).not.toContain('/api/tasks/task/1?x=y#z');
    expect(calledUrls).not.toContain('%25');
  });

  it.each(['.', '..'])('fails closed before PATCH fetch for dot id %s', async (dotId) => {
    const mutationConfigs: MutationConfig[] = [];
    useMutationMock.mockImplementation((config: MutationConfig) => {
      mutationConfigs.push(config);
      return {
        mutate: vi.fn(),
        isPending: false,
        variables: undefined,
      };
    });
    mockQueries();
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const statusMutation = mutationConfigs[0] as MutationConfig<VisitStatusPayload>;
    const taskStatusMutation = mutationConfigs[1] as MutationConfig<TaskStatusPayload>;

    await expect(
      statusMutation.mutationFn({ scheduleId: dotId, status: 'in_progress' }),
    ).rejects.toThrow(RangeError);
    await expect(
      taskStatusMutation.mutationFn({ taskId: dotId, status: 'in_progress' }),
    ).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buildOrgJsonHeadersMock).not.toHaveBeenCalled();
  });

  it('surfaces a toast instead of silently swallowing mutation failures', async () => {
    type MutationConfigWithHandlers = MutationConfig & {
      onError?: (error: unknown) => void;
    };
    const mutationConfigs: MutationConfigWithHandlers[] = [];
    useMutationMock.mockImplementation((config: MutationConfigWithHandlers) => {
      mutationConfigs.push(config);
      return { mutate: vi.fn(), isPending: false, variables: undefined };
    });
    mockQueries();
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    // statusMutation, taskStatusMutation, and applyRecommendedVehicleMutation all expose onError.
    const [statusMutation, taskStatusMutation, vehicleMutation] = mutationConfigs;
    expect(statusMutation?.onError).toBeTypeOf('function');
    expect(taskStatusMutation?.onError).toBeTypeOf('function');
    expect(vehicleMutation?.onError).toBeTypeOf('function');

    // Propagate thrown Error messages to the toast instead of silently swallowing failures.
    statusMutation!.onError!(new Error('訪問予定の更新に失敗しました'));
    expect(toastErrorMock).toHaveBeenLastCalledWith('訪問予定の更新に失敗しました');

    taskStatusMutation!.onError!(new Error('運用タスクの更新に失敗しました'));
    expect(toastErrorMock).toHaveBeenLastCalledWith('運用タスクの更新に失敗しました');

    vehicleMutation!.onError!(new Error('boom'));
    expect(toastErrorMock).toHaveBeenLastCalledWith('boom');

    // Non-Error values use the fallback message.
    vehicleMutation!.onError!('not-an-error');
    expect(toastErrorMock).toHaveBeenLastCalledWith('車両の割り当てに失敗しました');

    expect(toastErrorMock).toHaveBeenCalledTimes(4);
  });

  it('renders the new schedule board composition with rail and a single primary action', () => {
    mockQueries();
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    // 見出し帯 + 日/週トグル
    expect(screen.getByRole('heading', { level: 2, name: 'スケジュール' })).toBeTruthy();
    expect(screen.getByText(/訪問枠・未確定・車両を同じ日付で確認/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '予定を作る' }).className).toContain('min-h-[44px]');
    const toggle = screen.getByTestId('schedule-view-mode-toggle');
    expect(within(toggle).getByRole('link', { name: '日' }).className).toContain('min-h-[44px]');
    expect(within(toggle).getByRole('link', { name: '週' }).className).toContain('min-h-[44px]');

    // 今日の要点: ガント前に件数と未確定/車両判断を集約する
    const summary = screen.getByTestId('schedule-day-summary');
    expect(within(summary).getByRole('heading', { name: '今日の要点' })).toBeTruthy();
    expect(within(summary).getByText('訪問枠')).toBeTruthy();
    expect(within(summary).getByText('5件')).toBeTruthy();
    expect(within(summary).getByText('出発前要確認')).toBeTruthy();
    expect(within(summary).getByText('4件')).toBeTruthy();
    expect(within(summary).getByText('監査/記録')).toBeTruthy();
    expect(within(summary).getByText('6/2')).toBeTruthy();
    expect(within(summary).getByText('未確定')).toBeTruthy();
    expect(within(summary).getByText('車両反映')).toBeTruthy();
    expect(within(summary).getAllByText('1件').length).toBe(2);
    expect(within(summary).getByText('推奨あり')).toBeTruthy();

    // 全員ガント: 行ラベル + 余白バッジ + 凡例
    expect(screen.getByRole('heading', { name: '今日のスケジュール — 全員' })).toBeTruthy();
    expect(screen.getAllByText('山田(薬)').length).toBeGreaterThan(0);
    expect(screen.getByText('鈴木(事務)')).toBeTruthy();
    const capacitySummary = screen.getByTestId('team-board-capacity-summary');
    expect(within(capacitySummary).getByText('薬剤師稼働目安')).toBeTruthy();
    expect(within(capacitySummary).getByText('訪問')).toBeTruthy();
    expect(within(capacitySummary).getByText('210分')).toBeTruthy();
    expect(within(capacitySummary).getByText('移動')).toBeTruthy();
    expect(within(capacitySummary).getByText('90分')).toBeTruthy();
    expect(within(capacitySummary).getByText('概算余白')).toBeTruthy();
    expect(within(capacitySummary).getByText('120分')).toBeTruthy();
    expect(within(capacitySummary).getByText('仮枠(概算)')).toBeTruthy();
    expect(within(capacitySummary).getByText('約2枠')).toBeTruthy();
    expect(screen.getAllByTestId('team-board-idle').length).toBe(2);
    expect(screen.getAllByText('予定').length).toBeGreaterThan(0);
    expect(screen.getAllByText('準備完了').length).toBeGreaterThan(0);
    const gantt = screen.getByTestId('schedule-team-gantt');
    expect(Boolean(summary.compareDocumentPosition(gantt) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
    expect(
      within(gantt).getByLabelText(
        /伊藤 キヨ様、準備 2\/5、未完: 薬歴・前回変更の確認 \/ 持参薬・物品確認 \/ ルート確認/,
      ),
    ).toBeTruthy();
    expect(within(gantt).getAllByText('準備 2/5').length).toBeGreaterThan(0);
    expect(
      within(gantt).getByLabelText(
        /田中 一郎様、準備チェック完了、出発前条件 未解決2件、確認: 導入準備 2件/,
      ),
    ).toBeTruthy();
    expect(within(gantt).getAllByText('出発前条件 未解決2件').length).toBeGreaterThan(0);
    expect(
      within(gantt).getByLabelText(
        /施設グリーンヒル 12名、準備未完 1\/2、未完: 持参物ステータス未解決/,
      ),
    ).toBeTruthy();
    expect(within(gantt).getByText('準備未完 1/2')).toBeTruthy();
    expect(within(gantt).getByText('施設一括')).toBeTruthy();
    expect(
      within(gantt).queryByRole('link', { name: '施設グリーンヒル 12名の訪問を依頼' }),
    ).toBeNull();
    const operationalTasks = screen.getByTestId('schedule-operational-tasks');
    expect(within(operationalTasks).getByRole('heading', { name: '運用タスク' })).toBeTruthy();
    expect(within(operationalTasks).getByText('訪問準備を確認してください')).toBeTruthy();
    expect(within(operationalTasks).getByText(/伊藤 キヨ様 — 10:30/)).toBeTruthy();
    expect(within(operationalTasks).queryByText('翌日の準備')).toBeNull();
    const preparationLink = within(operationalTasks).getByRole('link', {
      name: /伊藤 キヨ様.*準備一覧へを開く/,
    });
    expect(preparationLink.getAttribute('href')).toBe(
      '/schedules?focus=schedule&schedule_id=visit_1',
    );
    expect(preparationLink.className).toContain('min-h-[44px]');
    expect(
      within(operationalTasks).queryByRole('button', { name: /伊藤 キヨ様.*完了にする/ }),
    ).toBeNull();
    expect(screen.getByText('訪問色＝ステータス')).toBeTruthy();
    expect(screen.getByText('斜線＝移動時間')).toBeTruthy();
    expect(screen.getByText('緑点線＝余白')).toBeTruthy();
    const vehicles = screen.getByTestId('schedule-vehicle-resources');
    expect(within(vehicles).getByText('車両リソース')).toBeTruthy();
    expect(within(vehicles).getByText('空き 2台')).toBeTruthy();
    expect(within(vehicles).getByText('軽バン1号')).toBeTruthy();
    expect(within(vehicles).getByText('推奨')).toBeTruthy();
    expect(within(vehicles).getByText('稼働 42分 / 上限 180分')).toBeTruthy();
    expect(within(vehicles).getByText(/未割当 1件を受けられます/)).toBeTruthy();
    expect(within(vehicles).getByRole('button', { name: '推奨車両を反映' })).toBeTruthy();
    const routePreview = screen.getByTestId('schedule-route-preview');
    expect(within(routePreview).getByText('訪問ルート')).toBeTruthy();
    expect(within(routePreview).getByRole('link', { name: 'ルート案を開く' }).className).toContain(
      'min-h-[44px]',
    );
    expect(within(routePreview).getByText('伊藤 キヨ様')).toBeTruthy();
    expect(within(routePreview).getByText('準備 2/5')).toBeTruthy();
    expect(
      within(routePreview).getByText('未完: 薬歴・前回変更の確認 / 持参薬・物品確認 / 他1件'),
    ).toBeTruthy();
    expect(within(routePreview).getAllByText('準備チェック完了').length).toBeGreaterThan(0);
    expect(within(routePreview).getByText('出発前条件: 導入準備 2件')).toBeTruthy();
    expect(within(routePreview).getAllByText(/軽バン1号/).length).toBeGreaterThan(0);
    expect(within(routePreview).getAllByText(/車両未割当/).length).toBeGreaterThan(0);
    const visitRequestLink = screen.getByRole('link', { name: '伊藤 キヨ様の訪問を依頼' });
    expect(visitRequestLink.getAttribute('href')).toContain(
      'work_request_type=staff_work_request_visit',
    );
    expect(visitRequestLink.className).toContain('size-11');
    expect(visitRequestLink.getAttribute('href')).toContain('related_entity_type=visit_schedule');
    expect(visitRequestLink.getAttribute('href')).toContain('related_entity_id=visit_1');

    // リスク警告(麻薬監査未完×14:00訪問)
    const banner = screen.getByTestId('schedule-risk-banner');
    expect(within(banner).getByText(/持参薬の麻薬監査が未完了\(期限12:00\)/)).toBeTruthy();
    expect(within(banner).getByRole('link', { name: '→ 監査へ' })).toBeTruthy();

    // 未確定(受入判断・仮枠・返答期限・余白の変化)
    const pending = screen.getByTestId('schedule-pending-proposals');
    expect(
      Boolean(gantt.compareDocumentPosition(operationalTasks) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(
      Boolean(operationalTasks.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(within(pending).getByText('受入判断')).toBeTruthy();
    expect(within(pending).getByText(/新規 鈴木 新様 — 明日 10:00 仮枠\(佐藤\)/)).toBeTruthy();
    expect(within(pending).getByText('返答期限 17:00')).toBeTruthy();
    expect(
      within(pending).getByText(/確定すると佐藤さんの明日の余白は 70分 → 25分 になります/),
    ).toBeTruthy();
    const proposalDetailLink = within(pending).getByRole('link', { name: '→ 確定フローへ' });
    expect(proposalDetailLink.getAttribute('href')).toBe(
      '/schedules/proposals?workspace=dashboard&status=patient_contact_pending&preset=contact&detail=proposal_1',
    );

    // 右レール: 次にやること(青主操作はこの1つ)/止まっている理由/根拠・記録
    expect(screen.getByRole('heading', { name: '次にやること' })).toBeTruthy();
    const nextAction = screen.getByRole('link', { name: '麻薬監査を開始 — 12:00期限' });
    expect(nextAction.getAttribute('href')).toBe('/audit');
    expect(screen.getByText(/14:00訪問\(田中 一郎様\)の持参薬です/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: '止まっている理由' })).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(screen.getByText('送付先の確認(やまもと内科)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '根拠・記録' })).toBeTruthy();
    expect(screen.getByText('移動時間の根拠')).toBeTruthy();
    expect(screen.getByText('ルート計算 09:40')).toBeTruthy();
    expect(screen.getByText('確定ルール')).toBeTruthy();

    // 主操作(青)が 1 つだけ: 次にやることのリンク以外の主ボタンは存在しない
    expect(screen.getByRole('link', { name: '予定を作る' })).toBeTruthy();
  });

  it('renders total pending proposal count while keeping only visible proposal rows', () => {
    mockQueries({
      board: {
        ...buildBoardFixture(),
        pending_proposal_counts: {
          total_count: 5,
          visible_count: 1,
          hidden_count: 4,
          limit: 3,
          hidden_operational_task_count: 2,
        },
      },
    });
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const summary = screen.getByTestId('schedule-day-summary');
    expect(within(summary).getByText('先頭1件 +他4件')).toBeTruthy();

    const pending = screen.getByTestId('schedule-pending-proposals');
    expect(within(pending).getByText('5件')).toBeTruthy();
    expect(within(pending).getByText('+4件')).toBeTruthy();
    expect(within(pending).getAllByTestId('pending-proposal-row')).toHaveLength(1);
    expect(
      within(pending).getByText(
        '先頭1件を表示中。他4件は候補一覧で確認してください。 未表示候補に運用タスク2件があります。',
      ),
    ).toBeTruthy();
    expect(within(pending).getByRole('link', { name: '→ 確定フローへ' }).getAttribute('href')).toBe(
      '/schedules/proposals?workspace=dashboard&status=patient_contact_pending&preset=contact&detail=proposal_1',
    );
  });

  it('uses staff count metadata so hidden staff work is not shown as an empty day', () => {
    mockQueries({
      board: {
        ...buildBoardFixture(),
        staff_counts: {
          total_count: 3,
          visible_count: 2,
          hidden_count: 1,
          total_visit_count: 7,
          visible_visit_count: 5,
          hidden_visit_count: 2,
          total_preparation_attention_count: 5,
          visible_preparation_attention_count: 4,
          hidden_preparation_attention_count: 1,
          hidden_operational_task_count: 3,
          limit: 6,
        },
      },
    });
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const summary = screen.getByTestId('schedule-day-summary');
    expect(within(summary).getByText('7件')).toBeTruthy();
    expect(within(summary).getByText('表示5件 +他2件 / 表示2名 +他1名')).toBeTruthy();
    expect(within(summary).getByText('5件')).toBeTruthy();
    expect(within(summary).getByText('表示4件 +他1件')).toBeTruthy();
    expect(within(summary).getByTestId('schedule-hidden-staff-counts').textContent).toContain(
      '非表示スタッフ1名、非表示訪問2件。運用タスク3件は詳細を展開せず件数のみ表示しています。',
    );
    expect(screen.getByText('非表示スタッフ1名は別集計')).toBeTruthy();
  });

  it('falls back to visible pending proposal length when count summary is absent', () => {
    const legacyBoard = {
      ...buildBoardFixture(),
      pending_proposal_counts: undefined,
    } as unknown as ScheduleDayBoardResponse;

    mockQueries({ board: legacyBoard });
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const pending = screen.getByTestId('schedule-pending-proposals');
    expect(within(pending).getByText('1件')).toBeTruthy();
    expect(within(pending).queryByText(/\+\d+件/)).toBeNull();
    expect(within(pending).getAllByTestId('pending-proposal-row')).toHaveLength(1);
  });

  it('routes change-requested pending proposals to reproposal from the day board', () => {
    const board = buildBoardFixture();
    const changeRequested = {
      ...board.pending_proposals[0],
      id: 'proposal_change',
      patient_name: '佐藤 変更',
      patient_contact_status: 'change_requested' as const,
      badge_label: '変更希望',
    };

    mockQueries({
      board: {
        ...board,
        pending_proposals: [changeRequested],
      },
    });
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const pending = screen.getByTestId('schedule-pending-proposals');
    expect(within(pending).getByText('変更希望')).toBeTruthy();
    expect(within(pending).getByText(/佐藤 変更様 — 明日 10:00 仮枠\(佐藤\)/)).toBeTruthy();
    const proposalDetailLink = within(pending).getByRole('link', { name: '→ 再提案へ' });
    expect(proposalDetailLink.getAttribute('href')).toBe(
      '/schedules/proposals?workspace=dashboard&status=reschedule_pending&preset=reschedule&detail=proposal_change',
    );
  });

  it('offers visit status changes from the staff gantt', () => {
    const mutate = vi.fn();
    useMutationMock.mockReturnValue({
      mutate,
      isPending: false,
      variables: undefined,
    });
    mockQueries();
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const controls = screen.getByTestId('schedule-status-controls');
    const statusSelect = within(controls).getByLabelText('伊藤 キヨ様のステータスを変更');
    expect(statusSelect).toBeTruthy();
    expect(within(controls).queryByRole('option', { name: '完了' })).toBeNull();
    expect(within(controls).queryByRole('option', { name: '中止' })).toBeNull();
    expect(within(controls).queryByLabelText('施設グリーンヒル 12名のステータスを変更')).toBeNull();

    fireEvent.change(statusSelect, { target: { value: 'in_progress' } });

    expect(mutate).toHaveBeenCalledWith({
      scheduleId: 'visit_1',
      status: 'in_progress',
    });
  });

  it('routes visible contact follow-up tasks to the contact result flow without confirming them inline', () => {
    const mutate = vi.fn();
    useMutationMock.mockReturnValue({
      mutate,
      isPending: false,
      variables: undefined,
    });
    mockQueries({
      board: {
        ...buildBoardFixture(),
        operational_tasks: [
          buildScheduleTask({
            id: 'task_contact',
            task_type: 'visit_contact_followup',
            title: '折返し架電が必要です',
            status: 'pending',
            priority: 'normal',
            related_entity_type: 'visit_schedule_proposal',
            related_entity_id: 'proposal_1',
          }),
          buildScheduleTask({
            id: 'task_cancelled',
            title: '完了済みの準備',
            status: 'completed',
            related_entity_id: 'visit_1',
          }),
        ],
      },
    });
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    const operationalTasks = screen.getByTestId('schedule-operational-tasks');
    expect(within(operationalTasks).getByText('折返し架電が必要です')).toBeTruthy();
    expect(within(operationalTasks).queryByText('完了済みの準備')).toBeNull();
    expect(
      within(operationalTasks).queryByRole('button', { name: /鈴木 新様.*完了にする/ }),
    ).toBeNull();
    expect(
      within(operationalTasks).queryByRole('button', {
        name: /鈴木 新様.*電話確認済みとして記録/,
      }),
    ).toBeNull();
    const contactAction = within(operationalTasks).getByRole('link', {
      name: /鈴木 新様.*連絡結果を記録を開く/,
    });
    expect(contactAction.className).toContain('min-h-[44px]');
    expect(contactAction.getAttribute('href')).toContain(
      '/schedules/proposals?workspace=dashboard&status=patient_contact_pending&preset=contact&detail=proposal_1',
    );

    fireEvent.click(
      within(operationalTasks).getByRole('button', { name: /鈴木 新様.*対応中にする/ }),
    );

    expect(mutate).toHaveBeenCalledWith({
      taskId: 'task_contact',
      status: 'in_progress',
    });
  });

  it('applies the recommended vehicle only to assignable unassigned visits', () => {
    const mutate = vi.fn();
    useMutationMock.mockReturnValue({
      mutate,
      isPending: false,
      variables: undefined,
    });
    mockQueries();
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    fireEvent.click(screen.getByRole('button', { name: '推奨車両を反映' }));

    expect(mutate).toHaveBeenCalledWith({
      vehicleId: 'vehicle_1',
      scheduleIds: ['visit_4'],
    });
  });

  it('renders only the heading row when the calendar (週) view is active', () => {
    mockQueries();
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="calendar" />);

    expect(screen.getByRole('heading', { name: 'スケジュール' })).toBeTruthy();
    expect(screen.queryByTestId('schedule-team-gantt')).toBeNull();
    expect(screen.queryByTestId('schedule-pending-proposals')).toBeNull();
  });
});
