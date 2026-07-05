// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse, stubJsonFetch } from '@/test/fetch-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useUIStore } from '@/lib/stores/ui-store';
import { toast } from 'sonner';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import type { OperationalPolicy, OperationalPolicyResponse } from './operational-policy-content';

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

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

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
        time_start: '14:00',
        time_end: '14:45',
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
    team_capacity: [],
  };
}

function mockQueries({
  policy = buildPolicyFixture(),
  cockpit = buildCockpitFixture(),
  cockpitError = false,
  cockpitRefetch = vi.fn(),
}: {
  policy?: OperationalPolicyResponse;
  cockpit?: DashboardCockpitResponse | null;
  cockpitError?: boolean;
  cockpitRefetch?: () => void;
} = {}) {
  useQueryMock.mockImplementation((options: { queryKey: unknown[] }) => {
    const key = options.queryKey[0];
    if (key === 'operational-policy') {
      return { data: policy, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    if (cockpitError) {
      return {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('当日の優先タスク取得に失敗しました'),
        refetch: cockpitRefetch,
      };
    }
    return { data: cockpit, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  });
  useMutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });
}

function renderWithCapturedQueries({
  policy = buildPolicyFixture(),
  cockpit = buildCockpitFixture(),
}: {
  policy?: OperationalPolicyResponse;
  cockpit?: DashboardCockpitResponse | null;
} = {}) {
  const queryConfigs = new Map<string, { queryKey: unknown[]; queryFn: () => unknown }>();
  const mutationConfigs: Array<{
    mutationFn: (values: Partial<OperationalPolicy>) => unknown;
    onSuccess?: (data: OperationalPolicyResponse) => unknown;
    onError?: (error: unknown) => unknown;
  }> = [];
  useQueryMock.mockImplementation((options: { queryKey: unknown[]; queryFn: () => unknown }) => {
    queryConfigs.set(String(options.queryKey[0]), options);
    const key = options.queryKey[0];
    if (key === 'operational-policy') {
      return { data: policy, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: cockpit, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  });
  useMutationMock.mockImplementation(
    (options: {
      mutationFn: (values: Partial<OperationalPolicy>) => unknown;
      onSuccess?: (data: OperationalPolicyResponse) => unknown;
    }) => {
      mutationConfigs.push(options);
      return { mutate: mutateMock, isPending: false };
    },
  );
  render(<OperationalPolicyContent />);
  return { queryConfigs, mutationConfigs };
}

function stubFetch(json: unknown = { data: buildPolicyFixture() }) {
  return stubJsonFetch(json);
}

beforeEach(() => {
  useUIStore.setState({ workspaceRailOpen: true });
  mutateMock.mockReset();
  vi.clearAllMocks();
});

describe('OperationalPolicyContent', () => {
  it('renders pharmacy policy cards, locked pills, ON pills and the rail', () => {
    mockQueries();
    render(<OperationalPolicyContent />);

    // 見出し帯: 設定 + 薬局名 + ロック注記
    expect(screen.getByRole('heading', { name: '設定' })).toBeTruthy();
    expect(screen.getByTestId('policy-pharmacy-chip').textContent).toContain(
      '薬局: ひまわり薬局 小倉北',
    );
    expect(screen.getByTestId('policy-lock-summary').textContent).toContain('安全3項目ロック');

    // Primary zone: 保存前確認・詰まり理由・次アクションを本文側にも出す
    const primaryStrip = screen.getByTestId('policy-primary-strip');
    expect(within(primaryStrip).getByText('保存前に影響範囲を確認')).toBeTruthy();
    expect(within(primaryStrip).getByText('3項目ロック / 今月3件の変更履歴')).toBeTruthy();
    expect(within(primaryStrip).getByText(/ご家族の同意待ち/)).toBeTruthy();
    expect(
      within(primaryStrip).getByRole('link', { name: '麻薬監査を開始 — 12:00期限' }),
    ).toBeTruthy();

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
    expect(within(notification).getByRole('switch', { name: '待ち解除の通知' }).textContent).toBe(
      'ON',
    );
    expect(within(notification).getByRole('switch', { name: '静かな時間' }).textContent).toBe('ON');

    // 影響範囲バナー
    expect(screen.getByTestId('policy-impact-banner').textContent).toContain('影響範囲');

    // 右レール: 次にやること(青主操作1つ)/止まっている理由/根拠・記録
    const nextActionPanel = screen.getByTestId('next-action-panel');
    const nextActionLink = within(nextActionPanel).getByRole('link', {
      name: '麻薬監査を開始 — 12:00期限',
    });
    expect(nextActionLink.getAttribute('href')).toBe('/audit');
    expect(within(nextActionPanel).getByText(/14:00訪問\(田中 一郎様\)の持参薬です/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: '止まっている理由' })).toBeTruthy();
    expect(screen.getByText('ご家族の同意待ち(新規契約)')).toBeTruthy();
    expect(screen.getByText('送付先の確認(やまもと内科)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '根拠・記録' })).toBeTruthy();
    expect(screen.getByText('設定の変更履歴')).toBeTruthy();
    expect(screen.getByText('今月3件')).toBeTruthy();
    expect(screen.getByText('権限')).toBeTruthy();
    expect(screen.getByText('管理者のみ変更可の項目あり')).toBeTruthy();

    const inventory = screen.getByTestId('settings-candidate-inventory');
    expect(within(inventory).getByRole('heading', { name: '設定に寄せる候補' })).toBeTruthy();
    expect(within(inventory).getByText('6ジャンル / 23項目')).toBeTruthy();
    expect(within(inventory).getByRole('heading', { name: '安全・工程' })).toBeTruthy();
    expect(within(inventory).getByRole('heading', { name: '通知・割り込み' })).toBeTruthy();
    expect(within(inventory).getByRole('heading', { name: 'スケジュール・余力' })).toBeTruthy();
    expect(within(inventory).getByRole('heading', { name: '薬局・マスター' })).toBeTruthy();
    expect(within(inventory).getByRole('heading', { name: 'セキュリティ・権限' })).toBeTruthy();
    expect(within(inventory).getByRole('heading', { name: 'オフライン・連携' })).toBeTruthy();
    expect(within(inventory).getByText('セッションタイムアウト・警告時刻')).toBeTruthy();
    expect(within(inventory).getByText('Webhook 再送・同時実行・タイムアウト')).toBeTruthy();
  });

  it('shows an explicit failure state (not a false "no blocked work" claim) when the cockpit rail query errors', () => {
    const cockpitRefetch = vi.fn();
    mockQueries({ cockpitError: true, cockpitRefetch });
    render(<OperationalPolicyContent />);

    // Primary strip: 「止まっている理由」欄は偽の空表示ではなく取得失敗を明示する
    const primaryStrip = screen.getByTestId('policy-primary-strip');
    const blockedSummary = within(primaryStrip).getByTestId('policy-blocked-summary');
    expect(within(blockedSummary).queryByText('いま期限で止まっている作業はありません。')).toBe(
      null,
    );
    expect(within(blockedSummary).getByText(/取得に失敗しました/)).toBeTruthy();
    expect(within(blockedSummary).getByText('—')).toBeTruthy();

    // 「次にやること」も偽の「今日の予定を確認する」ではなく再試行を促す
    expect(within(primaryStrip).queryByText('今日の予定を確認する')).toBe(null);
    expect(within(primaryStrip).getByRole('button', { name: '再試行する' })).toBeTruthy();
    expect(within(primaryStrip).getByText(/当日の優先タスクを取得できませんでした/)).toBeTruthy();

    // 右レール(補助パネル)側も同様に取得失敗を明示し、偽の「ありません」を出さない
    expect(screen.queryByText('止まっている作業はありません')).toBe(null);
    const rail = screen.getByTestId('workspace-action-rail');
    expect(within(rail).getByText(/取得に失敗しました/)).toBeTruthy();

    fireEvent.click(within(primaryStrip).getByRole('button', { name: '再試行する' }));
    expect(cockpitRefetch).toHaveBeenCalledTimes(1);
  });

  it('renders the cockpit rail as usual when the cockpit query succeeds (no regression from the error handling)', () => {
    mockQueries();
    render(<OperationalPolicyContent />);

    const primaryStrip = screen.getByTestId('policy-primary-strip');
    expect(within(primaryStrip).queryByText(/取得に失敗しました/)).toBe(null);
    expect(within(primaryStrip).getByText(/ご家族の同意待ち/)).toBeTruthy();
  });

  it('confirms the impact scope before saving a toggle change', () => {
    mockQueries();
    render(<OperationalPolicyContent />);

    fireEvent.click(screen.getByRole('switch', { name: '余白の計算' }));

    // 保存前に影響範囲を確認するダイアログ
    expect(screen.getByText('余白の計算を変更')).toBeTruthy();
    expect(screen.getByText(/対象: チーム全員のスケジュール画面とダッシュボード/)).toBeTruthy();
    const summary = screen.getByTestId('policy-change-summary');
    expect(within(summary).getByText('変更前')).toBeTruthy();
    expect(within(summary).getByText('変更後')).toBeTruthy();
    expect(within(summary).getAllByText('ON')).toHaveLength(1);
    expect(within(summary).getAllByText('OFF')).toHaveLength(1);
    expect(within(summary).getByRole('list', { name: '影響する画面' })).toBeTruthy();
    expect(within(summary).getByText('スケジュール')).toBeTruthy();
    expect(within(summary).getByText('ダッシュボード')).toBeTruthy();
    expect(
      within(summary).getByText(/ロック項目\(安全タグの表示・二人制監査・緊急\(赤\)の通知\)/),
    ).toBeTruthy();
    expect(mutateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存して反映' }));
    expect(mutateMock).toHaveBeenCalledWith({ slack_auto_calc: false });
  });

  it('disables editable controls when the viewer cannot edit (admin only)', () => {
    mockQueries({ policy: buildPolicyFixture({ can_edit: false }) });
    render(<OperationalPolicyContent />);

    expect((screen.getByRole('switch', { name: '余白の計算' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: '標準' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('fetches policy and rail cockpit with buildOrgHeaders while preserving static URLs and query keys', async () => {
    const sentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinel);
    const { queryConfigs } = renderWithCapturedQueries();
    const policyPayload = buildPolicyFixture();
    const fetchMock = stubFetch({ data: policyPayload });

    try {
      await expect(queryConfigs.get('operational-policy')!.queryFn()).resolves.toEqual(
        policyPayload,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [policyUrl, policyInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(policyUrl).toBe('/api/settings/operational-policy');
      expect(policyInit.headers).toBe(sentinel);
      expect(queryConfigs.get('operational-policy')!.queryKey).toEqual([
        'operational-policy',
        'org_1',
      ]);

      const cockpitPayload = buildCockpitFixture();
      fetchMock.mockImplementation(async () => jsonResponse({ data: cockpitPayload }));
      fetchMock.mockClear();
      await expect(queryConfigs.get('settings-rail-cockpit')!.queryFn()).resolves.toEqual(
        cockpitPayload,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [cockpitUrl, cockpitInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(cockpitUrl).toBe('/api/dashboard/cockpit');
      expect(cockpitInit.headers).toBe(sentinel);
      expect(queryConfigs.get('settings-rail-cockpit')!.queryKey).toEqual([
        'settings-rail-cockpit',
        'org_1',
      ]);

      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('patches the operational policy with buildOrgJsonHeaders and the exact values body', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs } = renderWithCapturedQueries();
    const fetchMock = stubFetch({
      data: buildPolicyFixture({ policy: buildPolicyFixture().policy }),
    });
    const values: Partial<OperationalPolicy> = {
      safety_sign_sensitivity: 'high',
      quiet_hours: false,
    };

    try {
      await mutationConfigs[0].mutationFn(values);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/settings/operational-policy');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      expect(JSON.parse(init.body as string)).toEqual(values);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('surfaces API error messages when operational policy updates fail', async () => {
    const { mutationConfigs } = renderWithCapturedQueries();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: '運用ポリシーの更新権限がありません' }, 403));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(mutationConfigs[0].mutationFn({ quiet_hours: false })).rejects.toThrow(
        '運用ポリシーの更新権限がありません',
      );
      mutationConfigs[0].onError?.(new Error('運用ポリシーの更新権限がありません'));

      expect(fetchMock).toHaveBeenCalledWith('/api/settings/operational-policy', {
        method: 'PATCH',
        headers: buildOrgJsonHeaders('org_1'),
        body: JSON.stringify({ quiet_hours: false }),
      });
      expect(toast.error).toHaveBeenCalledWith('運用ポリシーの更新権限がありません');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
