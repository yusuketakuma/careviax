// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';

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

import { DashboardCockpit } from './dashboard-cockpit';

function localIso(hours: number, minutes = 0) {
  return new Date(2026, 5, 12, hours, minutes).toISOString();
}

function buildFixture(): DashboardCockpitResponse {
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
    today_visits: [
      {
        id: 'visit_1',
        patient_name: '伊藤',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: localIso(10, 30),
        time_end: localIso(11, 30),
        facility_batch_id: null,
      },
      {
        id: 'visit_2',
        patient_name: '田中',
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
    carryover_count: 2,
  };
}

describe('DashboardCockpit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 12, 9, 42));
    refetchMock.mockClear();
    useRealtimeQueryMock.mockReturnValue({
      data: buildFixture(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the page header row with the scope toggle', () => {
    render(<DashboardCockpit />);

    expect(screen.getByRole('heading', { name: 'ダッシュボード' })).toBeTruthy();
    expect(screen.getByText(/6\/12\(金\) 09:42 — 私の今日/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'チーム全体' }));
    expect(screen.getByText(/— チーム全体/)).toBeTruthy();
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
    expect(within(section).getByText('今すぐ対応')).toBeTruthy();
    expect(within(section).getByText('2件')).toBeTruthy();

    const cards = within(section).getAllByTestId('dashboard-urgent-card');
    expect(cards).toHaveLength(2);

    // 1枚目: 麻薬監査(危険タグを隠さない)+ 期限カウントダウン + 主操作(青)は 1 つ
    expect(within(cards[0]).getByText('田中 一郎 様')).toBeTruthy();
    expect(within(cards[0]).getByText('麻薬監査')).toBeTruthy();
    expect(within(cards[0]).getByText('麻薬')).toBeTruthy();
    expect(within(cards[0]).getByText('冷所')).toBeTruthy();
    expect(within(cards[0]).getByText('RX-2024-0500')).toBeTruthy();
    expect(within(cards[0]).getByText('期限 12:00 — あと 2時間18分')).toBeTruthy();
    expect(within(section).getAllByRole('link', { name: '監査を開始する' })).toHaveLength(1);

    // 2枚目: タグなしは「安全タグなし」を明示し、主操作はアウトライン
    expect(within(cards[1]).getByText('佐々木 ハル 様')).toBeTruthy();
    expect(within(cards[1]).getByText('安全タグなし')).toBeTruthy();
    expect(within(cards[1]).getByRole('link', { name: '監査を開く' })).toBeTruthy();
  });

  it('renders the today flow timeline with locked visits, desk work, and the now marker', () => {
    render(<DashboardCockpit />);

    const section = screen.getByTestId('dashboard-today-flow');
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
    for (const label of ['取込', '入力', '判断', '調剤', '監査', 'セット', '訪問', '報告', '算定']) {
      expect(within(section).getByText(label)).toBeTruthy();
    }
    // 監査 = dispensed(10) + audit_pending(14)
    expect(within(section).getByText('24')).toBeTruthy();
    expect(within(section).getByText('目安14')).toBeTruthy();
    expect(
      within(section).getByText('詰まりは判断と監査。上流の工程を今増やしても、今日は速くなりません。'),
    ).toBeTruthy();
    expect(within(section).getByRole('link', { name: '→ ハンドオフで再配分' })).toBeTruthy();
  });

  it('renders the action rail with next action, blocked reasons, evidence, and my-today list', () => {
    render(<DashboardCockpit />);

    const nextAction = screen.getByTestId('next-action-panel');
    expect(within(nextAction).getByText('次にやること')).toBeTruthy();
    expect(within(nextAction).getByRole('link', { name: '麻薬監査を開始 — 12:00期限' })).toBeTruthy();

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

    const myToday = screen.getByTestId('dashboard-my-today');
    expect(within(myToday).getByText('私の今日')).toBeTruthy();
    expect(within(myToday).getByText('10:30')).toBeTruthy();
    expect(within(myToday).getByText('伊藤 様')).toBeTruthy();
  });

  it('shows the error state with retry when the cockpit fetch fails', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: refetchMock,
    });

    render(<DashboardCockpit />);

    expect(screen.getByText('ダッシュボードを表示できません')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchMock).toHaveBeenCalled();
  });
});
