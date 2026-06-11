// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { OperationalPolicyResponse } from './operational-policy-content';

const { useQueryMock, useMutationMock, mutateMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

import { OperationalPolicyContent } from './operational-policy-content';

setupDomTestEnv();

function localIso(hours: number, minutes = 0) {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function buildPolicyFixture(
  overrides: Partial<OperationalPolicyResponse> = {},
): OperationalPolicyResponse {
  return {
    generated_at: localIso(9, 42),
    pharmacy_label: 'ひまわり薬局 小倉北',
    can_edit: true,
    policy: {
      safety_sign_sensitivity: 'standard',
      slack_auto_calc: true,
      interrupt_guard: true,
      wait_release_notification: true,
      quiet_hours: true,
    },
    locked_items: [
      { key: 'safety_tag_display', label: '安全タグの表示', reason: '常時表示' },
      { key: 'two_person_audit', label: '二人制監査', reason: '無効化不可' },
      { key: 'emergency_notification', label: '緊急(赤)の通知', reason: '常にON' },
    ],
    wip_revision_label: '4/1改定',
    change_log_count_this_month: 3,
    ...overrides,
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
    today_visits: [
      {
        id: 'visit_1',
        patient_name: '田中 一郎',
        visit_type: 'regular',
        schedule_status: 'planned',
        time_start: localIso(14, 0),
        time_end: localIso(14, 45),
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
    carryover_count: 0,
  };
}

function mockQueries({
  policy = buildPolicyFixture(),
  cockpit = buildCockpitFixture(),
}: {
  policy?: OperationalPolicyResponse;
  cockpit?: DashboardCockpitResponse | null;
} = {}) {
  useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
    const key = options.queryKey[0];
    if (key === 'operational-policy') {
      return { data: policy, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: cockpit, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  });
  useMutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });
}

beforeEach(() => {
  mutateMock.mockReset();
});

describe('OperationalPolicyContent', () => {
  it('renders pharmacy policy cards, locked pills, ON pills and the rail', () => {
    mockQueries();
    render(<OperationalPolicyContent />);

    // 見出し帯: 設定 + 薬局名 + ロック注記
    expect(screen.getByRole('heading', { name: '設定' })).toBeTruthy();
    expect(screen.getByText(/薬局: ひまわり薬局 小倉北 — 安全項目はロック/)).toBeTruthy();

    // 安全カード: ロック2件 + 感度セグメント(標準が選択中)
    const safety = screen.getByTestId('policy-safety-card');
    expect(within(safety).getByText('安全タグの表示')).toBeTruthy();
    expect(within(safety).getByText('二人制監査')).toBeTruthy();
    expect(within(safety).getAllByTestId('policy-locked-pill')).toHaveLength(2);
    const standard = within(safety).getByRole('button', { name: '標準' });
    expect(standard.getAttribute('aria-pressed')).toBe('true');

    // 働き方カード: WIP目安(4/1改定 + 詰まり管理へ)、ON ピル
    const workstyle = screen.getByTestId('policy-workstyle-card');
    expect(within(workstyle).getByText('WIP目安')).toBeTruthy();
    expect(within(workstyle).getByText('4/1改定')).toBeTruthy();
    expect(within(workstyle).getByRole('link', { name: '→ 詰まり管理へ' })).toBeTruthy();
    expect(within(workstyle).getByRole('switch', { name: '余白の計算' }).textContent).toBe('ON');
    expect(within(workstyle).getByRole('switch', { name: '割り込み防護' }).textContent).toBe('ON');

    // 通知カード: 緊急はロック、待ち解除/静かな時間は ON
    const notification = screen.getByTestId('policy-notification-card');
    expect(within(notification).getByText('緊急(赤)の通知')).toBeTruthy();
    expect(within(notification).getAllByTestId('policy-locked-pill')).toHaveLength(1);
    expect(
      within(notification).getByRole('switch', { name: '待ち解除の通知' }).textContent,
    ).toBe('ON');
    expect(within(notification).getByRole('switch', { name: '静かな時間' }).textContent).toBe(
      'ON',
    );

    // 影響範囲バナー
    expect(screen.getByTestId('policy-impact-banner').textContent).toContain('影響範囲');

    // 右レール: 次にやること(青主操作1つ)/止まっている理由/根拠・記録
    const nextActionLink = screen.getByRole('link', { name: '麻薬監査を開始 — 12:00期限' });
    expect(nextActionLink.getAttribute('href')).toBe('/auditing');
    expect(screen.getByText(/14:00訪問\(田中 一郎様\)の持参薬です/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: '止まっている理由' })).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(screen.getByText('送付先の確認(やまもと内科)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '根拠・記録' })).toBeTruthy();
    expect(screen.getByText('設定の変更履歴')).toBeTruthy();
    expect(screen.getByText('今月3件')).toBeTruthy();
    expect(screen.getByText('権限')).toBeTruthy();
    expect(screen.getByText('管理者のみ変更可の項目あり')).toBeTruthy();
  });

  it('confirms the impact scope before saving a toggle change', () => {
    mockQueries();
    render(<OperationalPolicyContent />);

    fireEvent.click(screen.getByRole('switch', { name: '余白の計算' }));

    // 保存前に影響範囲を確認するダイアログ
    expect(screen.getByText('余白の計算を変更')).toBeTruthy();
    expect(screen.getByText(/対象: チーム全員のスケジュール画面とダッシュボード/)).toBeTruthy();
    expect(mutateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存して反映' }));
    expect(mutateMock).toHaveBeenCalledWith({ slack_auto_calc: false });
  });

  it('disables editable controls when the viewer cannot edit (admin only)', () => {
    mockQueries({ policy: buildPolicyFixture({ can_edit: false }) });
    render(<OperationalPolicyContent />);

    expect(
      (screen.getByRole('switch', { name: '余白の計算' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '標準' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
