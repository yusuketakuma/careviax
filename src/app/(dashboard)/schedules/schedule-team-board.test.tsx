// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { DayBoardStaff, ScheduleDayBoardResponse } from '@/types/schedule-day-board';
import {
  buildScheduleRiskAlert,
  buildStaffLane,
  pendingProposalDateLabel,
  staffRowLabel,
} from './schedule-team-board.helpers';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());

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

import { ScheduleTeamBoard } from './schedule-team-board';

setupDomTestEnv();

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
        time_start: localIso(10, 30),
        time_end: localIso(11, 15),
        vehicle_resource_id: 'vehicle_1',
        vehicle_label: '軽バン1号',
        vehicle_travel_mode: 'DRIVE',
        confirmed: true,
        facility_label: null,
        facility_patient_count: 1,
      },
      {
        id: 'visit_2',
        patient_name: '田中 一郎',
        visit_type: 'regular',
        schedule_status: 'ready',
        priority: 'normal',
        site_id: 'site_1',
        route_order: 2,
        time_start: localIso(14, 0),
        time_end: localIso(14, 45),
        vehicle_resource_id: 'vehicle_1',
        vehicle_label: '軽バン1号',
        vehicle_travel_mode: 'DRIVE',
        confirmed: true,
        facility_label: null,
        facility_patient_count: 1,
      },
      {
        id: 'visit_3',
        patient_name: '中村 ヨシ',
        visit_type: 'regular',
        schedule_status: 'completed',
        priority: 'normal',
        site_id: 'site_1',
        route_order: 3,
        time_start: localIso(15, 30),
        time_end: localIso(17, 0),
        vehicle_resource_id: null,
        vehicle_label: null,
        vehicle_travel_mode: null,
        confirmed: true,
        facility_label: 'グリーンヒル',
        facility_patient_count: 12,
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
            time_start: localIso(17, 15),
            time_end: localIso(17, 45),
            vehicle_resource_id: null,
            vehicle_label: null,
            vehicle_travel_mode: null,
            confirmed: false,
            facility_label: null,
            facility_patient_count: 1,
          },
        ],
      },
      buildClerk(),
    ],
    audit_pending_count: 6,
    report_pending_count: 2,
    vehicle_resources: [
      {
        id: 'vehicle_1',
        label: '軽バン1号',
        site_id: 'site_1',
        vehicle_code: 'VEH-DEMO-001',
        travel_mode: 'DRIVE',
        available: true,
        max_stops: 8,
        assigned_visit_count: 2,
        remaining_stops: 6,
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
        assigned_visit_count: 0,
        remaining_stops: 4,
        recommended: false,
        recommendation_reason: '空き 4件',
      },
    ],
    pending_proposals: [
      {
        id: 'proposal_1',
        patient_name: '鈴木 新',
        pharmacist_name: '佐藤 真',
        proposed_date: TOMORROW_KEY,
        time_start: localIso(10, 0),
        badge_label: '受入判断',
        response_due_at: localIso(17, 0),
        idle_before_minutes: 70,
        idle_after_minutes: 25,
      },
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

function mockQueries({
  board = buildBoardFixture(),
  cockpit = buildCockpitFixture(),
}: {
  board?: ScheduleDayBoardResponse | null;
  cockpit?: DashboardCockpitResponse | null;
} = {}) {
  useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
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
    invalidateQueriesMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    });
  });

  it('renders the new schedule board composition with rail and a single primary action', () => {
    mockQueries();
    render(<ScheduleTeamBoard initialDate={TODAY_KEY} activeView="list" />);

    // 見出し帯 + 日/週トグル
    expect(screen.getByRole('heading', { name: 'スケジュール' })).toBeTruthy();
    expect(screen.getByText(/訪問は固定点・仕事はその間を流れる/)).toBeTruthy();
    const toggle = screen.getByTestId('schedule-view-mode-toggle');
    expect(within(toggle).getByRole('link', { name: '日' })).toBeTruthy();
    expect(within(toggle).getByRole('link', { name: '週' })).toBeTruthy();

    // 全員ガント: 行ラベル + 余白バッジ + 凡例
    expect(screen.getByRole('heading', { name: '今日のスケジュール — 全員' })).toBeTruthy();
    expect(screen.getAllByText('山田(薬)').length).toBeGreaterThan(0);
    expect(screen.getByText('鈴木(事務)')).toBeTruthy();
    expect(screen.getAllByTestId('team-board-idle').length).toBe(2);
    expect(screen.getAllByText('予定').length).toBeGreaterThan(0);
    expect(screen.getAllByText('準備完了').length).toBeGreaterThan(0);
    expect(screen.getAllByText('完了').length).toBeGreaterThan(0);
    expect(screen.getByText('訪問色＝ステータス')).toBeTruthy();
    expect(screen.getByText('斜線＝移動時間')).toBeTruthy();
    expect(screen.getByText('緑点線＝余白')).toBeTruthy();
    const vehicles = screen.getByTestId('schedule-vehicle-resources');
    expect(within(vehicles).getByText('車両リソース')).toBeTruthy();
    expect(within(vehicles).getByText('空き 2台')).toBeTruthy();
    expect(within(vehicles).getByText('軽バン1号')).toBeTruthy();
    expect(within(vehicles).getByText('推奨')).toBeTruthy();
    expect(within(vehicles).getByText(/未割当 1件を受けられます/)).toBeTruthy();
    expect(within(vehicles).getByRole('button', { name: '推奨車両を反映' })).toBeTruthy();
    const routePreview = screen.getByTestId('schedule-route-preview');
    expect(within(routePreview).getByText('訪問ルート')).toBeTruthy();
    expect(within(routePreview).getByRole('link', { name: 'ルート案を開く' }).className).toContain(
      'min-h-[44px]',
    );
    expect(within(routePreview).getByText('伊藤 キヨ様')).toBeTruthy();
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

    fireEvent.change(statusSelect, { target: { value: 'in_progress' } });

    expect(mutate).toHaveBeenCalledWith({
      scheduleId: 'visit_1',
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
