// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { SetWorkspaceResponse, SetWorkspaceRow } from './set-workspace.shared';

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

import { SetWorkspace, aggregateSetRows, sortRowsByRoom } from './set-workspace';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 11, hours, minutes).toISOString();
}

function buildRow(args: {
  id: string;
  name: string;
  room: string;
  status: SetWorkspaceRow['status'];
  allergy?: boolean;
  assignee?: string | null;
}): SetWorkspaceRow {
  return {
    patient_id: args.id,
    patient_name: args.name,
    room_label: args.room,
    has_allergy: args.allergy ?? false,
    slots: { morning: 'set', noon: 'set', evening: args.status === 'completed' ? 'set' : 'none' },
    status: args.status,
    assignee_label: args.assignee === undefined ? '鈴木(事務)' : args.assignee,
  };
}

function buildWorkspaceFixture(): SetWorkspaceResponse {
  const inProgressRows: SetWorkspaceRow[] = Array.from({ length: 6 }, (_, index) =>
    buildRow({
      id: `patient_other_${index}`,
      name: `入居 患者${index}`,
      room: `${104 + index}`,
      status: 'in_progress',
    }),
  );
  return {
    generated_at: localIso(9, 42),
    scope: 'today',
    facility_groups: [
      {
        facility_id: 'facility_gh',
        facility_name: 'グリーンヒル',
        visit_time: localIso(15, 30),
        rows: [
          buildRow({ id: 'patient_ogawa', name: '小川 タケ', room: '101', status: 'completed' }),
          buildRow({ id: 'patient_yamaguchi', name: '山口 清', room: '102', status: 'completed' }),
          buildRow({
            id: 'patient_nakamura',
            name: '中村 ヨシ',
            room: '103',
            status: 'quantity_check',
            allergy: true,
          }),
          ...inProgressRows,
        ],
        completed_count: 2,
        total_count: 9,
        lane_counts: { normal: 16, cold: 3, narcotic: 2 },
        final_check_assignee: '山田',
      },
    ],
    pending_items: [
      {
        id: 'audit-waiting-cycle_tanaka',
        kind: 'audit_waiting',
        badge_label: '監査待ち',
        title: '田中 一郎 様 — 本日14:00 持参分',
        subtitle: '監査合格と同時にここへ自動で現れます。麻薬・冷所のため山田が直接セットします。',
        meta_label: '所要15分',
        action_label: '→ 監査へ',
        action_href: '/auditing',
      },
      {
        id: 'preworkable-tomorrow',
        kind: 'preworkable',
        badge_label: '明日分',
        title: '渡辺 フミ 様(冷所)・松本 トヨ 様',
        subtitle: null,
        meta_label: '余白で先行可(20分)',
        action_label: '→ ダッシュボードへ',
        action_href: '/dashboard',
      },
    ],
    evidence: {
      cart_map_count: 1,
      cold_storage_log_status: '正常',
    },
  };
}

function buildCockpitFixture(): DashboardCockpitResponse {
  return {
    generated_at: localIso(9, 42),
    cycle_status_counts: {},
    audit_pending_count: 1,
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
    today_visits: [
      {
        id: 'visit_1',
        patient_name: '田中 一郎',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: localIso(14, 0),
        time_end: localIso(15, 0),
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
    carryover_count: 0,
  };
}

function mockQueries({
  workspace,
  cockpit,
}: {
  workspace: SetWorkspaceResponse | null;
  cockpit: DashboardCockpitResponse | null;
}) {
  useRealtimeQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
    const isCockpit = options.queryKey[0] === 'dashboard';
    return {
      data: isCockpit ? cockpit : workspace,
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    };
  });
}

describe('SetWorkspace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 9, 42));
    useRealtimeQueryMock.mockReset();
    refetchMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('施設グループ(レーンチップ・居室テーブル・最終確認行)と右レールを描画する', () => {
    mockQueries({ workspace: buildWorkspaceFixture(), cockpit: buildCockpitFixture() });
    render(<SetWorkspace />);

    // ヘッダー: 見出し + 物理対応の説明 + 本日分/明日以降トグル
    expect(screen.getByRole('heading', { name: 'セット' })).toBeTruthy();
    expect(screen.getByText(/物理の画面: カート・トレイと1対1対応/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /本日分/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /明日以降/ })).toBeTruthy();

    // 施設グループ見出し帯 + 先行準備の説明 + 進捗バー
    expect(
      screen.getByRole('heading', { name: '施設グリーンヒル — 15:30訪問分' }),
    ).toBeTruthy();
    expect(screen.getByText(/2\/9 完了・事務が許可済みの範囲で先行準備中/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'セット完了の進捗' })).toBeTruthy();

    // レーンチップ(麻薬=施錠保管表記で常時可視)
    const laneChips = screen.getByLabelText('レーン別件数');
    expect(within(laneChips).getByText(/通常レーン/)).toBeTruthy();
    expect(within(laneChips).getByText(/冷所レーン/)).toBeTruthy();
    expect(within(laneChips).getByText(/(施錠保管)/)).toBeTruthy();

    // 行: 完了 / アレルギータグ / 数量確認中 + ハンドオフ導線
    expect(screen.getAllByText('完了')).toHaveLength(2);
    expect(screen.getByText('アレルギー')).toBeTruthy();
    expect(screen.getByText('数量確認中')).toBeTruthy();
    expect(screen.getByRole('link', { name: '→ ハンドオフへ' })).toBeTruthy();

    // 末尾の進行中 6 行は 1 行へ集約される
    const aggregateRow = screen.getByTestId('set-workspace-aggregate-row');
    expect(within(aggregateRow).getByText('104〜109')).toBeTruthy();
    expect(within(aggregateRow).getByText('ほか6名')).toBeTruthy();
    expect(within(aggregateRow).getByText('進行中 6/6 着手')).toBeTruthy();

    // 薬剤師の最終確認(事務完了後)
    const finalRow = screen.getByTestId('set-workspace-final-check-row');
    expect(within(finalRow).getByText('薬剤師の最終確認')).toBeTruthy();
    expect(within(finalRow).getByText('事務完了後')).toBeTruthy();
    expect(within(finalRow).getByText('山田')).toBeTruthy();

    // 工程待ちのセット
    expect(screen.getByRole('heading', { name: '工程待ちのセット' })).toBeTruthy();
    expect(screen.getByText('田中 一郎 様 — 本日14:00 持参分')).toBeTruthy();
    expect(screen.getByText('所要15分')).toBeTruthy();
    expect(screen.getByText('余白で先行可(20分)')).toBeTruthy();

    // 右レール: 主操作はこの 1 つだけ(麻薬監査 12:00 期限)
    expect(screen.getByRole('link', { name: '麻薬監査を開始 — 12:00期限' })).toBeTruthy();
    expect(screen.getByText('止まっている理由')).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(screen.getByText('根拠・記録')).toBeTruthy();
    expect(screen.getByText('配薬カート対応表')).toBeTruthy();
    expect(screen.getByText('セット写真')).toBeTruthy();
    expect(screen.getByText('冷所温度ログ')).toBeTruthy();
  });

  it('施設グループが無いときは空状態を出しつつ工程待ちのセットは残す', () => {
    const fixture = buildWorkspaceFixture();
    fixture.facility_groups = [];
    mockQueries({ workspace: fixture, cockpit: buildCockpitFixture() });
    render(<SetWorkspace />);

    expect(screen.getByText('本日分の施設セットはありません')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '工程待ちのセット' })).toBeTruthy();
  });
});

describe('aggregateSetRows / sortRowsByRoom', () => {
  it('末尾の進行中・着手前の連続区間だけを集約する', () => {
    const rows: SetWorkspaceRow[] = [
      buildRow({ id: 'a', name: 'A', room: '101', status: 'completed' }),
      buildRow({ id: 'b', name: 'B', room: '103', status: 'quantity_check' }),
      buildRow({ id: 'c', name: 'C', room: '104', status: 'in_progress' }),
      buildRow({ id: 'd', name: 'D', room: '105', status: 'waiting' }),
    ];

    const { detailed, aggregate } = aggregateSetRows(rows);
    expect(detailed.map((row) => row.patient_id)).toEqual(['a', 'b']);
    expect(aggregate?.room_label).toBe('104〜105');
    expect(aggregate?.patient_label).toBe('ほか2名');
    expect(aggregate?.status_label).toBe('進行中 1/2 着手');
  });

  it('集約対象が 1 行なら集約しない', () => {
    const rows: SetWorkspaceRow[] = [
      buildRow({ id: 'a', name: 'A', room: '101', status: 'completed' }),
      buildRow({ id: 'c', name: 'C', room: '104', status: 'in_progress' }),
    ];
    const { detailed, aggregate } = aggregateSetRows(rows);
    expect(detailed).toHaveLength(2);
    expect(aggregate).toBeNull();
  });

  it('居室番号の数値順で並べる', () => {
    const rows: SetWorkspaceRow[] = [
      buildRow({ id: 'b', name: 'B', room: '110', status: 'completed' }),
      buildRow({ id: 'a', name: 'A', room: '9', status: 'completed' }),
    ];
    expect(sortRowsByRoom(rows).map((row) => row.room_label)).toEqual(['9', '110']);
  });
});
