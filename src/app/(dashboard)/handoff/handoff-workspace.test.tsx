// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useUIStore } from '@/lib/stores/ui-store';
import type { DashboardCockpitResponse } from '@/types/dashboard-cockpit';
import {
  HandoffWorkspace,
  fetchHandoffBoard,
  fetchHandoffConfirmationTasks,
  fetchOperationCockpit,
  fetchRecentComments,
  fetchVisitHandoff,
} from './handoff-workspace';
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

vi.mock('sonner', async () => {
  const { createSonnerToastMock } = await import('@/test/sonner-test-utils');
  return createSonnerToastMock().module;
});

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
  options: {
    handoffTasks?: Array<Record<string, unknown>>;
    cockpitResponse?: Promise<Response>;
    cockpitStatus?: number;
    recentCommentsStatus?: number;
    recentComments?: Array<Record<string, unknown>>;
    handoffDetail?: Record<string, unknown>;
    itemPostFailure?: Response | ((body: Record<string, unknown>) => Response);
    itemReadFailure?: Response;
    itemResolveFailure?: Response;
  } = {},
) {
  const cockpitStatus = options.cockpitStatus ?? 200;
  const recentCommentsStatus = options.recentCommentsStatus ?? 200;
  const recentComments = options.recentComments ?? [];
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
    if (url.includes('/api/handoff-board/items/') && url.includes('/resolve')) {
      if (options.itemResolveFailure) {
        return options.itemResolveFailure;
      }
      return jsonResponse({ data: { id: 'resolved_handoff', consult_status: 'checking' } });
    }
    if (url.includes('/api/handoff-board/items') && init?.method === 'POST') {
      if (options.itemPostFailure) {
        if (typeof options.itemPostFailure === 'function') {
          return options.itemPostFailure(JSON.parse(String(init.body ?? '{}')));
        }
        return options.itemPostFailure;
      }
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
    if (url.includes('/api/handoff-board/items/') && init?.method === 'PATCH') {
      if (options.itemReadFailure) {
        return options.itemReadFailure;
      }
      return new Response(JSON.stringify({ data: { read_at: '2026-06-11T01:00:00.000Z' } }), {
        status: 200,
      });
    }
    if (url.includes('/api/handoff-board')) {
      return new Response(JSON.stringify({ data: board }), { status: 200 });
    }
    if (url.includes('/api/dashboard/cockpit')) {
      if (options.cockpitResponse) {
        return options.cockpitResponse;
      }
      if (cockpitStatus !== 200) {
        return new Response(
          JSON.stringify({ message: '当日オペレーション情報の取得に失敗しました' }),
          {
            status: cockpitStatus,
          },
        );
      }
      return new Response(JSON.stringify({ data: COCKPIT }), { status: 200 });
    }
    if (url.includes('/api/tasks')) {
      return new Response(JSON.stringify({ data: handoffTasks }), { status: 200 });
    }
    if (url.includes('/api/comments/recent')) {
      if (recentCommentsStatus !== 200) {
        return new Response(JSON.stringify({ message: 'やり取りの取得に失敗しました' }), {
          status: recentCommentsStatus,
        });
      }
      return new Response(JSON.stringify({ data: recentComments }), { status: 200 });
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
        JSON.stringify(
          options.handoffDetail ?? {
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
            visit_record_version: 7,
            visit_record_updated_at: '2026-06-11T00:00:00.000Z',
            confirmation_policy: {
              can_confirm: true,
              requires_override_reason: false,
              authorized_basis: 'assigned_schedule',
              override_reason_max_length: 500,
            },
          },
        ),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderWorkspace() {
  return render(<HandoffWorkspace />, { wrapper: createQueryClientWrapper() });
}

async function submitCompleteTransferDraft() {
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
  it('keeps API messages from failed handoff workspace read fetches', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: 'ハンドオフデータを表示できません' }, 403),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHandoffBoard('org_1')).rejects.toThrow('ハンドオフデータを表示できません');
    await expect(fetchOperationCockpit('org_1')).rejects.toThrow(
      'ハンドオフデータを表示できません',
    );
    await expect(fetchHandoffConfirmationTasks('org_1')).rejects.toThrow(
      'ハンドオフデータを表示できません',
    );
    await expect(fetchRecentComments('org_1')).rejects.toThrow('ハンドオフデータを表示できません');
    await expect(fetchVisitHandoff('org_1', 'visit_record_1')).rejects.toThrow(
      'ハンドオフデータを表示できません',
    );

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/handoff-board',
      '/api/dashboard/cockpit',
      '/api/tasks?status=pending&task_type=handoff_confirmation',
      '/api/comments/recent',
      '/api/visit-records/visit_record_1/handoff',
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toMatchObject({ 'x-org-id': 'org_1' });
    }
  });

  it('preserves visit record version from the handoff detail response', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
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
        visit_record_version: 7,
        visit_record_updated_at: '2026-06-11T00:00:00.000Z',
        confirmation_policy: {
          can_confirm: true,
          requires_override_reason: false,
          authorized_basis: 'assigned_schedule',
          override_reason_max_length: 500,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVisitHandoff('org_1', 'visit_record_1')).resolves.toMatchObject({
      data: { next_check_items: ['残薬を確認'] },
      visit_record_version: 7,
      confirmation_policy: { can_confirm: true },
    });
  });

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
    expect(screen.getByRole('link', { name: '状況を聞く' }).getAttribute('href')).toBe(
      '/communications/requests?status=sent',
    );

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

  it('passes visit record version through the handoff workspace confirmation flow', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const fetchMock = stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText('残薬を確認')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
        ),
      ).toBe(true);
    });
    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      confirmed: true,
      expected_visit_record_version: 7,
    });
  });

  it('passes override reason through the handoff workspace confirmation flow', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'owner_1' });
    const fetchMock = stubFetch(BOARD, {
      handoffDetail: {
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
        visit_record_version: 7,
        visit_record_updated_at: '2026-06-11T00:00:00.000Z',
        confirmation_policy: {
          can_confirm: false,
          requires_override_reason: true,
          authorized_basis: 'admin_emergency_override',
          override_reason_max_length: 500,
        },
      },
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText('管理者代行確認')).toBeTruthy();
    });

    const button = screen.getByRole('button', { name: '管理者として確定' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('代行理由'), {
      target: { value: '担当者不在のため本日訪問前に確認が必要' },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
        ),
      ).toBe(true);
    });
    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/visit-records/visit_record_1/handoff' && init?.method === 'PUT',
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      confirmed: true,
      expected_visit_record_version: 7,
      override_reason: '担当者不在のため本日訪問前に確認が必要',
    });
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

  it('keeps server messages when transfer creation fails', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch(BOARD, {
      itemPostFailure: new Response(JSON.stringify({ message: 'この仕事は既に渡されています' }), {
        status: 409,
      }),
    });
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
      expect(toast.error).toHaveBeenCalledWith('この仕事は既に渡されています');
    });
  });

  it('keeps error envelopes and non-JSON fallbacks when transfer creation fails', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch(BOARD, {
      itemPostFailure: jsonResponse({ error: '宛先ユーザーが見つかりません' }, 400),
    });
    const firstRender = renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    await submitCompleteTransferDraft();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('宛先ユーザーが見つかりません');
    });

    firstRender.unmount();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    stubFetch(BOARD, {
      itemPostFailure: new Response('not-json', { status: 500 }),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    await submitCompleteTransferDraft();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('仕事を渡せませんでした');
    });
  });

  it('keeps server messages and fallbacks for message and consult creation failures', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1', role: 'clerk' });
    stubFetch(BOARD, {
      itemPostFailure: (body) => {
        if (body.kind === 'message') {
          return jsonResponse({ error: 'この宛先へ連絡する権限がありません' }, 403);
        }
        if (body.consult_status === 'open') {
          return new Response('not-json', { status: 500 });
        }
        return jsonResponse({ message: '送信できません' }, 400);
      },
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-message-channel')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('連絡の宛先'));
    fireEvent.click(screen.getByRole('option', { name: '鈴木 一郎(事務スタッフ)' }));
    fireEvent.change(screen.getByLabelText('連絡内容'), {
      target: { value: '14時の鈴木様、保冷剤の準備をお願いします' },
    });
    fireEvent.click(screen.getByTestId('handoff-message-send'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('この宛先へ連絡する権限がありません');
    });

    fireEvent.click(screen.getByLabelText('相談先の薬剤師'));
    fireEvent.click(screen.getByRole('option', { name: '佐藤 薬剤師(薬剤師)' }));
    fireEvent.change(screen.getByLabelText('相談内容'), {
      target: { value: '同成分薬の重複疑い。用法は妥当か確認をお願いします' },
    });
    fireEvent.click(screen.getByTestId('handoff-consult-submit'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('相談を起票できませんでした');
    });
  });

  it('shows the priority label, not the raw enum, in the transfer dialog select', async () => {
    // bare <SelectValue /> は既定値 'normal' の生 enum を初期表示で漏らす。
    // 明示 children で常に日本語ラベル('通常')を表示することを固定する(SSR enum 漏れ封止)。
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-open-transfer'));
    const priorityTrigger = await screen.findByLabelText('優先度');
    expect(priorityTrigger.textContent).toContain('通常');
    expect(priorityTrigger.textContent).not.toContain('normal');
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

  it('falls back when receipt confirmation fails without a server message', async () => {
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
    stubFetch(board, {
      itemReadFailure: new Response('server error', { status: 500 }),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '受領確認' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '受領確認' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('受領確認に失敗しました');
    });
  });

  it.each([
    [{ message: '申し送り項目が見つかりません' }, '申し送り項目が見つかりません'],
    [{ error: '申し送りの既読権限がありません' }, '申し送りの既読権限がありません'],
  ])('keeps server receipt confirmation errors from %j', async (payload, expectedMessage) => {
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
    stubFetch(board, {
      itemReadFailure: jsonResponse(payload, 403),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '受領確認' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '受領確認' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expectedMessage);
    });
  });

  it('keeps server messages when message read confirmation fails', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const board: HandoffBoardResponse = {
      ...BOARD,
      items: [
        buildItem({
          id: 'message_in',
          content: '14時の鈴木様、保冷剤の準備をお願いします',
          created_by: 'user_2',
          created_by_name: '鈴木 一郎',
          recipient_user_id: 'user_1',
          recipient_label: '山田さん(薬剤師)',
          lifecycle_status: null,
          consult_status: null,
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board, {
      itemReadFailure: jsonResponse({ error: '連絡の既読権限がありません' }, 403),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-message-confirm')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-message-confirm'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('連絡の既読権限がありません');
    });
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

  it('keeps the action rail loading instead of showing false no-blockers copy while operation status loads', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    stubFetch(BOARD, { cockpitResponse: new Promise<Response>(() => undefined) });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    expect(screen.getByTestId('handoff-action-rail-loading')).toBeTruthy();
    expect(screen.queryByText('止まっている作業はありません')).toBeNull();
    expect(screen.queryByText('いま期限で止まっている作業はありません。')).toBeNull();
  });

  it('shows a cockpit rail error instead of a false no-blockers state when operation status fails', async () => {
    useAuthStore.getState().setCurrentUser({ id: 'user_1' });
    const fetchMock = stubFetch(BOARD, { cockpitStatus: 500 });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-outgoing-section')).toBeTruthy();
    });
    expect(await screen.findByText('稼働状況を取得できませんでした')).toBeTruthy();
    expect(screen.getByText(/問題なしではなく取得エラーです/)).toBeTruthy();
    expect(screen.queryByText('止まっている作業はありません')).toBeNull();
    expect(screen.queryByText('いま期限で止まっている作業はありません。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/dashboard/cockpit'))
          .length,
      ).toBeGreaterThanOrEqual(2);
    });
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

  it('keeps server messages when pharmacist consultation resolution fails', async () => {
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
          direction: 'incoming',
        }),
      ],
      summary: { outgoing_count: 0, incoming_count: 1 },
    };
    stubFetch(board, {
      itemResolveFailure: jsonResponse(
        { message: 'この相談は他のユーザーによって更新されています。再読み込みしてください' },
        409,
      ),
    });
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-consult-action-acknowledged')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('handoff-consult-action-acknowledged'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'この相談は他のユーザーによって更新されています。再読み込みしてください',
      );
    });
  });

  it('disables handoff realtime and data loading until org is available', () => {
    useOrgIdMock.mockReturnValue('');
    const fetchMock = stubFetch();

    renderWorkspace();

    expect(useRealtimeEventsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a recent-comments fetch failure with retry instead of silently hiding the やり取り feed', async () => {
    // 取得失敗を「あなた宛コメント無し」と区別できないと連携記録が無言で消える false-empty。
    const fetchMock = stubFetch(BOARD, { recentCommentsStatus: 500 });

    renderWorkspace();

    const feed = await screen.findByTestId('handoff-comment-feed');
    expect(within(feed).getByText(/やり取りを読み込めませんでした/)).toBeTruthy();
    const retry = within(feed).getByRole('button', { name: '再読み込み' });

    const commentCallsBefore = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/comments/recent'),
    ).length;
    fireEvent.click(retry);
    await waitFor(() => {
      const commentCallsAfter = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/api/comments/recent'),
      ).length;
      expect(commentCallsAfter).toBeGreaterThan(commentCallsBefore);
    });
  });

  it('renders the やり取り feed with recent comments and no error on a successful load', async () => {
    stubFetch(BOARD, {
      recentComments: [
        {
          id: 'comment_1',
          entity_type: 'care_report',
          entity_id: 'report_1',
          author_name: '佐藤 太郎',
          content: '次回訪問で残薬を確認してください',
          mentions_me: true,
          created_at: '2026-06-11T02:00:00.000Z',
        },
      ],
    });

    renderWorkspace();

    const feed = await screen.findByTestId('handoff-comment-feed');
    expect(within(feed).getByText('次回訪問で残薬を確認してください')).toBeTruthy();
    // a successful (non-empty) load must not show the error affordance
    expect(within(feed).queryByText(/やり取りを読み込めませんでした/)).toBeNull();
    expect(within(feed).queryByRole('button', { name: '再読み込み' })).toBeNull();
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
