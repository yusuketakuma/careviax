import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, vi } from 'vitest';
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
} from '../handoff-workspace';
import {
  buildHeaderMeta,
  buildItemSubText,
  buildItemTitle,
  buildStatusBadge,
  progressPercent,
  remainingLabel,
  type HandoffBoardItem,
  type HandoffBoardResponse,
} from '../handoff-workspace.helpers';

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
      return new Response(
        JSON.stringify({ data: handoffTasks, meta: { has_more: false, next_cursor: null } }),
        { status: 200 },
      );
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
      if (url.includes('/supervision-confirm') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ data: { confirmed_at: '2026-06-11T01:00:00.000Z' } }),
          {
            status: 200,
          },
        );
      }
      if (url.includes('/supervision-request') && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { status: 'requested' } }), {
          status: 200,
        });
      }
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
            meta: {
              visit_record_version: 7,
              visit_record_updated_at: '2026-06-11T00:00:00.000Z',
              confirmation_policy: {
                can_confirm: true,
                requires_override_reason: false,
                authorized_basis: 'assigned_schedule',
                override_reason_max_length: 500,
              },
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

export function getHandoffWorkspaceTestSupport() {
  return {
    BOARD,
    buildHeaderMeta,
    buildItem,
    buildItemSubText,
    buildItemTitle,
    buildStatusBadge,
    fetchHandoffBoard,
    fetchHandoffConfirmationTasks,
    fetchOperationCockpit,
    fetchRecentComments,
    fetchVisitHandoff,
    jsonResponse,
    progressPercent,
    QueryClient,
    remainingLabel,
    renderWorkspace,
    stubFetch,
    submitCompleteTransferDraft,
    toast,
    useAuthStore,
    useOrgIdMock,
    useRealtimeEventsMock,
  };
}
