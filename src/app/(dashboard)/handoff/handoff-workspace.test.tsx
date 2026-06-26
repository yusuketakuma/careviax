// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useUIStore } from '@/lib/stores/ui-store';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import { HandoffWorkspace } from './handoff-workspace';
import {
  buildHeaderMeta,
  buildItemSubText,
  buildItemTitle,
  buildStatusBadge,
  progressPercent,
  remainingLabel,
  type HandoffBoardItem,
  type HandoffBoardResponse,
} from './handoff-workspace.helpers';

setupDomTestEnv();

const { useOrgIdMock, useRealtimeEventsMock } = vi.hoisted(() => ({
  useOrgIdMock: vi.fn(),
  useRealtimeEventsMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

function buildItem(overrides: Partial<HandoffBoardItem>): HandoffBoardItem {
  return {
    id: 'item_x',
    content: '件名',
    priority: 'normal',
    entity_type: null,
    entity_id: null,
    read_by: [],
    created_by: 'user_1',
    created_by_name: '山田 花子',
    created_at: '2026-06-11T00:38:00.000Z',
    recipient_user_id: null,
    recipient_label: null,
    recipient_name: null,
    lifecycle_status: null,
    scope: null,
    rationale: null,
    deadline: null,
    progress_done: null,
    progress_total: null,
    consult_status: null,
    resolution_action: null,
    resolution_note: null,
    resolved_by: null,
    resolved_at: null,
    direction: 'outgoing',
    ...overrides,
  };
}

const BOARD: HandoffBoardResponse = {
  id: 'board_1',
  shift_date: '2026-06-11',
  recipient_options: [
    { id: 'user_2', name: '鈴木 一郎', role: 'clerk', role_label: '事務スタッフ' },
    { id: 'user_3', name: '佐藤 薬剤師', role: 'pharmacist', role_label: '薬剤師' },
  ],
  items: [
    buildItem({
      id: 'item_1',
      content: '判断キュー 定型12件',
      recipient_label: '佐藤さん',
      lifecycle_status: 'proposed',
      rationale: '判断WIP 18/目安12 — あなたの余白11分では捌けないため',
      entity_type: 'dashboard',
      entity_id: 'dashboard',
    }),
    buildItem({
      id: 'item_2',
      content: 'セット先行準備(施設GH)',
      recipient_label: '鈴木さん(事務)',
      lifecycle_status: 'in_progress',
      scope: '数量セットまで。最終確認は薬剤師(あなた)',
      progress_done: 9,
      progress_total: 12,
      entity_type: 'medication_set',
      entity_id: 'set_1',
    }),
    buildItem({
      id: 'item_3',
      content: '送付先の確認(やまもと内科)',
      recipient_label: '事務',
      lifecycle_status: 'confirming',
      rationale: '完了しないと田中様の本日報告書が送れません',
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      entity_type: 'reports',
      entity_id: 'reports',
    }),
  ],
  month_item_count: 31,
  summary: { outgoing_count: 3, incoming_count: 0 },
};

const COCKPIT: DashboardCockpitResponse = {
  generated_at: '2026-06-11T00:00:00.000Z',
  cycle_status_counts: {},
  audit_pending_count: 1,
  narcotic_audit_count: 1,
  audit_queue: [
    {
      task_id: 'task_1',
      cycle_id: 'cycle_1',
      patient_name: '田中 一郎',
      priority: 'normal',
      due_at: '2026-06-11T03:00:00.000Z',
      intake_id: 'intake_1',
      prescribed_date: '2026-06-01',
      handling_tags: ['narcotic'],
      has_narcotic: true,
      waiting_since: null,
    },
  ],
  today_visits: [],
  blocked_reasons: [
    {
      id: 'block_1',
      label: 'ご家族の同意待ち(新規契約)',
      severity: 'critical',
      category: '患者',
      age_minutes: 25 * 60,
      action_label: '再連絡する →',
      action_href: '/communications/requests',
    },
  ],
  carryover_count: 0,
  team_capacity: [],
};

function stubFetch(
  board: HandoffBoardResponse = BOARD,
  options: { handoffTasks?: Array<Record<string, unknown>> } = {},
) {
  const handoffTasks = options.handoffTasks ?? [
    {
      id: 'task_handoff_1',
      title: '申し送り確認: 田中 一郎',
      task_type: 'handoff_confirmation',
      priority: 'normal',
      due_date: null,
      related_entity_id: 'visit_record_1',
      created_at: '2026-06-11T00:00:00.000Z',
    },
  ];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/handoff-board/items') && init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          data: {
            id: 'created_handoff',
            board_id: 'board_1',
            content: 'セット先行準備(施設GH)',
          },
        }),
        { status: 201 },
      );
    }
    if (url.includes('/api/handoff-board')) {
      return new Response(JSON.stringify({ data: board }), { status: 200 });
    }
    if (url.includes('/api/dashboard/cockpit')) {
      return new Response(JSON.stringify({ data: COCKPIT }), { status: 200 });
    }
    if (url.includes('/api/tasks')) {
      return new Response(JSON.stringify({ data: handoffTasks }), { status: 200 });
    }
    if (url.includes('/api/visit-records/visit_record_1/handoff')) {
      if (init?.method === 'PUT') {
        return new Response(
          JSON.stringify({ data: { confirmed_at: '2026-06-11T01:00:00.000Z' } }),
          {
            status: 200,
          },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            next_check_items: ['残薬を確認'],
            ongoing_monitoring: ['眠気'],
            decision_rationale: '訪問時に眠気の訴えあり',
            ai_extracted: true,
            ai_confidence: 0.88,
            confirmed_by: null,
            confirmed_at: null,
            extracted_at: '2026-06-11T00:00:00.000Z',
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HandoffWorkspace />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useUIStore.setState({ workspaceRailOpen: true });
  vi.clearAllMocks();
  useOrgIdMock.mockReturnValue('org_1');
  useRealtimeEventsMock.mockReturnValue({ connected: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().resetAuth();
});

describe('HandoffWorkspace', () => {
  it('renders 私が渡した cards with status badges, 3-point summaries and rule bar', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch();
    renderWorkspace();

    expect(screen.getByText('ハンドオフ')).toBeTruthy();
    // 主操作(青)は「+ 仕事を渡す」1 つだけ
    expect(screen.getByTestId('handoff-open-transfer')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByTestId('visit-handoff-confirmation-workspace')).toBeTruthy();
    });
    expect(screen.getByText('訪問申し送り確認')).toBeTruthy();
    expect(screen.getByText('申し送り確認: 田中 一郎')).toBeTruthy();
    expect(screen.getByText('残薬を確認')).toBeTruthy();

    // ヘッダーメタ(渡した/来た)
    expect(screen.getByText(/渡した3・来た0/)).toBeTruthy();
    expect(
      screen.getByText(/3件 — 渡す=責任の移動。受領確認と根拠が必ず記録されます/),
    ).toBeTruthy();

    // 状態バッジ: 承諾待ち(紫)/作業中 9\/12(青)/確認中(橙)
    expect(screen.getByText('承諾待ち')).toBeTruthy();
    expect(screen.getByText('作業中 9/12')).toBeTruthy();
    expect(screen.getByText(/^確認中/)).toBeTruthy();

    // 件名 → 宛先
    expect(screen.getByText('判断キュー 定型12件 → 佐藤さん')).toBeTruthy();
    expect(screen.getByText('セット先行準備(施設GH) → 鈴木さん(事務)')).toBeTruthy();
    expect(screen.getByText('送付先の確認(やまもと内科) → 事務')).toBeTruthy();

    // 3点セット要約と戻り先リンク
    expect(
      screen.getByText('根拠: 判断WIP 18/目安12 — あなたの余白11分では捌けないため'),
    ).toBeTruthy();
    expect(
      screen.getByText('許可済みの範囲: 数量セットまで。最終確認は薬剤師(あなた)'),
    ).toBeTruthy();
    expect(screen.getByText('→ ダッシュボードへ')).toBeTruthy();
    expect(screen.getByText('→ セットへ')).toBeTruthy();
    expect(screen.getByText('→ 報告・共有へ')).toBeTruthy();
    expect(screen.getByText('状況を聞く')).toBeTruthy();

    // 私に来た: 0 件は done(緑) success 表現ではなく neutral な空状態 + チームルール注記
    const incomingEmpty = screen.getByTestId('handoff-incoming-empty');
    expect(incomingEmpty.getAttribute('role')).toBe('status');
    expect(incomingEmpty.textContent).toBe('受け取り待ちの仕事はありません');
    expect(incomingEmpty.className).not.toContain('state-done');
    expect(incomingEmpty.className).toContain('text-muted-foreground');
    expect(screen.getByText(/対応は監査ログに残ります/)).toBeTruthy();

    // 3点セットのルール帯
    expect(screen.getByTestId('handoff-rule-bar').textContent).toContain(
      '3つ揃わないと送信できません',
    );

    // 右レール 根拠・記録
    expect(screen.getByText('ハンドオフ履歴')).toBeTruthy();
    expect(screen.getByText('今月31件')).toBeTruthy();
    expect(screen.getByText('許可済み事務作業の範囲')).toBeTruthy();
  });

  it('disables transfer submission until the 3-point set is complete', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    const submit = await screen.findByRole('button', { name: '渡す(責任を移す)' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    // 無効理由が未充足項目を示し、ボタンへ aria-describedby で接続される
    expect(submit.getAttribute('aria-describedby')).toBe('handoff-transfer-missing');
    expect(screen.getByText(/未入力のため渡せません:/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('件名'), {
      target: { value: 'セット先行準備(施設GH)' },
    });
    fireEvent.click(screen.getByLabelText('宛先(誰に渡すか)'));
    fireEvent.click(screen.getByRole('option', { name: '鈴木 一郎(事務スタッフ)' }));
    fireEvent.change(screen.getByLabelText('①何を(作業の範囲)'), {
      target: { value: '数量セットまで' },
    });
    fireEvent.change(screen.getByLabelText('②なぜ(根拠)'), {
      target: { value: '判断WIPが目安超過のため' },
    });
    // 期限が無い間は送信できない
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('③いつまで(期限)'), {
      target: { value: '2026-06-11T17:00' },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    // 全項目が揃えば無効理由は消える
    expect(submit.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText(/未入力のため渡せません:/)).toBeNull();
  });

  it('creates transfers with the selected recipient user id so the recipient can receive it', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const fetchMock = stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    fireEvent.change(await screen.findByLabelText('件名'), {
      target: { value: 'セット先行準備(施設GH)' },
    });
    fireEvent.click(screen.getByLabelText('宛先(誰に渡すか)'));
    fireEvent.click(screen.getByRole('option', { name: '鈴木 一郎(事務スタッフ)' }));
    fireEvent.change(screen.getByLabelText('①何を(作業の範囲)'), {
      target: { value: '数量セットまで' },
    });
    fireEvent.change(screen.getByLabelText('②なぜ(根拠)'), {
      target: { value: '判断WIPが目安超過のため' },
    });
    fireEvent.change(screen.getByLabelText('③いつまで(期限)'), {
      target: { value: '2026-06-11T17:00' },
    });

    fireEvent.click(screen.getByRole('button', { name: '渡す(責任を移す)' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/handoff-board/items',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/handoff-board/items' && init?.method === 'POST',
    );
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      board_id: 'board_1',
      content: 'セット先行準備(施設GH)',
      recipient_user_id: 'user_2',
      recipient_label: '鈴木 一郎(事務スタッフ)',
      lifecycle_status: 'proposed',
      scope: '数量セットまで',
      rationale: '判断WIPが目安超過のため',
    });
  });

  it('shows 受領確認 action for incoming items', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'item_in',
          content: '疑義照会の判断をお願いします',
          created_by: 'user_2',
          created_by_name: '鈴木 一郎',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          lifecycle_status: 'proposed',
          rationale: '判断が必要なため',
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText('疑義照会の判断をお願いします → 山田さん(薬剤師)')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: '受領確認' })).toBeTruthy();
    expect(screen.queryByTestId('handoff-incoming-empty')).toBeNull();
  });

  it('keeps the newest incoming item primary and tucks the rest behind a receipt backlog disclosure', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const incoming = (id: string, content: string) =>
      buildItem({
        id,
        content,
        created_by: 'user_2',
        created_by_name: '鈴木 一郎',
        recipient_user_id: 'user_1',
        recipient_label: '山田さん(薬剤師)',
        lifecycle_status: 'proposed',
        rationale: '判断が必要なため',
        direction: 'incoming',
      });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        incoming('item_in_1', '同成分薬の重複疑いについて確認をお願いします'),
        incoming('item_in_2', 'FAX番号の確認が弱いため、送付前に判断してください'),
        incoming('item_in_3', '報告書に入れるべき確認事項か判断をお願いします'),
      ],
      summary: { outgoing_count: 0, incoming_count: 3 },
    };
    stubFetch(board);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText(/同成分薬の重複疑いについて確認をお願いします/)).toBeTruthy();
    });
    const overflow = screen.getByTestId('handoff-incoming-overflow');
    expect(overflow.textContent).toContain('残りの受領待ち');
    expect(overflow.textContent).toContain('2件');
    expect(overflow.textContent).toContain('FAX番号の確認が弱いため');
    expect(overflow.textContent).toContain('報告書に入れるべき確認事項');
  });

  it('keeps transfer submission disabled when no active recipient options are available', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch({ ...BOARD, recipient_options: [] });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    expect(await screen.findByText(/宛先候補を取得できません/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '渡す(責任を移す)' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('refreshes board queries from workflow realtime events', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    let realtimeOptions: { onEvent: (event: unknown) => void } | null = null;
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const getRealtimeOptions = () => {
      if (!realtimeOptions) throw new Error('realtime options were not captured');
      return realtimeOptions;
    };
    useRealtimeEventsMock.mockImplementation((options: { onEvent: (event: unknown) => void }) => {
      realtimeOptions = options;
      return { connected: true };
    });
    const fetchMock = stubFetch();
    const handoffBoardFetchCount = () =>
      fetchMock.mock.calls.filter(([input]) => String(input) === '/api/handoff-board').length;

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    await waitFor(() => {
      expect(handoffBoardFetchCount()).toBe(1);
    });

    getRealtimeOptions().onEvent({ type: 'workflow_refresh' });

    await waitFor(() => {
      expect(handoffBoardFetchCount()).toBeGreaterThan(1);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['nav-badges'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['tasks', 'handoff-confirmation', 'org_1'],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['nav-badges', 'handoff'] });
    invalidateSpy.mockRestore();
  });

  it('renders the pharmacist consultation workspace inside the canonical handoff board', async () => {
    // 相談の「対応」は薬剤師のみ。viewer を薬剤師にして解決パネルの描画を検証する。
    useAuthStore.getState().setCurrentUser({ id: 'user_1', role: 'pharmacist' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'consult_1',
          content: '用法・用量の確認をお願いします。',
          created_by: 'user_2',
          created_by_name: '鈴木 事務',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          consult_status: 'open',
          rationale: '確認してほしいこと\n・用法が妥当か\n・医師へ確認が必要か',
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-consult-workspace')).toBeTruthy();
    });
    expect(screen.getByText('相談一覧')).toBeTruthy();
    expect(screen.getByText('相談内容')).toBeTruthy();
    expect(screen.getByText('薬剤師の対応')).toBeTruthy();
    expect(screen.getByTestId('handoff-open-transfer')).toBeTruthy();
    expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    expect(screen.getByTestId('handoff-incoming-section')).toBeTruthy();
  });

  it('hides the pharmacist resolution panel from clerks (canAuthorReport gate, FE)', async () => {
    // 事務(clerk)は相談を閲覧・起票できるが「薬剤師の対応」パネルは見えない(二重防御)。
    useAuthStore.getState().setCurrentUser({ id: 'user_1', role: 'clerk' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'consult_clerk',
          content: '用法・用量の確認をお願いします。',
          created_by: 'user_1',
          created_by_name: '鈴木 事務',
          recipient_user_id: 'user_3',
          recipient_label: '佐藤さん(薬剤師)',
          consult_status: 'open',
          direction: 'outgoing',
        }),
      ],
      summary: { outgoing_count: 1, incoming_count: 0 },
    };
    stubFetch(board);
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-consult-workspace')).toBeTruthy();
    });
    // 相談は見える(閲覧・起票は可)
    expect(screen.getByText('相談一覧')).toBeTruthy();
    expect(screen.getByTestId('handoff-consult-intake')).toBeTruthy();
    // 対応パネルは出ず、読み取り専用の説明に置き換わる
    expect(screen.queryByText('薬剤師の対応')).toBeNull();
    expect(screen.getByTestId('handoff-consult-resolution-readonly')).toBeTruthy();
  });

  it('disables handoff realtime and data loading until org is available', () => {
    useOrgIdMock.mockReturnValue('');
    const fetchMock = stubFetch();

    renderWorkspace();

    expect(useRealtimeEventsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handoff-workspace helpers', () => {
  it('builds header meta with summary', () => {
    expect(buildHeaderMeta(new Date(2026, 5, 11), { outgoing_count: 3, incoming_count: 0 })).toBe(
      '6/11(木) — 渡した3・来た0',
    );
  });

  it('maps lifecycle status to badge labels and tones', () => {
    const now = new Date('2026-06-11T09:00:00');
    expect(buildStatusBadge(buildItem({ lifecycle_status: 'proposed' }), now).label).toBe(
      '承諾待ち',
    );
    const inProgress = buildStatusBadge(
      buildItem({ lifecycle_status: 'in_progress', progress_done: 9, progress_total: 12 }),
      now,
    );
    expect(inProgress.label).toBe('作業中 9/12');
    expect(inProgress.className).toContain('info');
    const confirming = buildStatusBadge(
      buildItem({
        lifecycle_status: 'confirming',
        deadline: new Date(now.getTime() + 30 * 60_000).toISOString(),
      }),
      now,
    );
    expect(confirming.label).toBe('確認中 30分');
    expect(confirming.className).toContain('confirm');
    expect(buildStatusBadge(buildItem({ consult_status: 'open' }), now).label).toBe('薬剤師相談');
    expect(buildStatusBadge(buildItem({}), now).label).toBe('要確認');
  });

  it('computes remaining deadline labels including overdue', () => {
    const now = new Date('2026-06-11T09:00:00');
    expect(remainingLabel(new Date(now.getTime() + 90 * 60_000).toISOString(), now)).toBe('1時間');
    expect(remainingLabel(new Date(now.getTime() - 60_000).toISOString(), now)).toBe('超過');
  });

  it('computes progress percent only for in-progress items', () => {
    expect(
      progressPercent(
        buildItem({ lifecycle_status: 'in_progress', progress_done: 9, progress_total: 12 }),
      ),
    ).toBe(75);
    expect(progressPercent(buildItem({ lifecycle_status: 'proposed' }))).toBeNull();
  });

  it('builds title and sub text per status', () => {
    expect(buildItemTitle(buildItem({ content: 'A', recipient_label: 'Bさん' }))).toBe('A → Bさん');
    expect(
      buildItemSubText(buildItem({ lifecycle_status: 'proposed', rationale: 'WIP超過' })),
    ).toBe('根拠: WIP超過');
    expect(
      buildItemSubText(buildItem({ lifecycle_status: 'in_progress', scope: '数量セットまで' })),
    ).toBe('許可済みの範囲: 数量セットまで');
    expect(
      buildItemSubText(
        buildItem({ lifecycle_status: 'confirming', rationale: '報告が止まるため' }),
      ),
    ).toBe('報告が止まるため');
  });
});
