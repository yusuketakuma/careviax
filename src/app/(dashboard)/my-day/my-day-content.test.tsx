// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { MemberRole } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useAuthStoreMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const fetchAllCursorPagesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/api/cursor-pagination-client', () => ({
  fetchAllCursorPages: fetchAllCursorPagesMock,
}));

vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

import { MyDayContent } from './my-day-content';

setupDomTestEnv();

const emptyCockpit = {
  generated_at: '2026-04-10T00:00:00.000Z',
  cycle_status_counts: {},
  audit_pending_count: 0,
  narcotic_audit_count: 0,
  audit_queue: [],
  today_visits: [],
  blocked_reasons: [],
  carryover_count: 0,
};

type MockAuthState = {
  currentUser: {
    id: string | null;
    role: MemberRole | null;
  };
};

type QueryCallOptions = {
  queryKey: unknown[];
  queryFn?: () => Promise<unknown>;
  enabled?: boolean;
};

function mockCurrentUser({
  id = 'user_1',
  role = 'pharmacist',
}: {
  id?: string | null;
  role?: MemberRole | null;
} = {}) {
  useAuthStoreMock.mockImplementation((selector: (state: MockAuthState) => unknown) =>
    selector({ currentUser: { id, role } }),
  );
}

function findQueryOptions(key: string): QueryCallOptions {
  const call = useQueryMock.mock.calls.find((args) => {
    const options = args[0] as QueryCallOptions | undefined;
    return options?.queryKey[0] === key;
  });
  expect(call).toBeTruthy();
  return call?.[0] as QueryCallOptions;
}

describe('MyDayContent', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchAllCursorPagesMock.mockResolvedValue({ data: [] });
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/my-day');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    mockCurrentUser();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      switch (queryKey[0]) {
        case 'my-day-visits':
          return {
            data: {
              data: [
                {
                  id: 'visit_1',
                  case_: { patient: { name: '山田花子' } },
                  visit_type: 'regular',
                  time_window_start: '2026-04-10T09:00:00.000Z',
                  time_window_end: '2026-04-10T10:00:00.000Z',
                  schedule_status: 'planned',
                  preparation: null,
                },
                {
                  id: 'visit_2',
                  case_: { patient: { name: '佐藤次郎' } },
                  visit_type: 'regular',
                  time_window_start: '2026-04-10T11:00:00.000Z',
                  time_window_end: '2026-04-10T12:00:00.000Z',
                  schedule_status: 'departed',
                  preparation: { prepared_at: '2026-04-10T08:00:00.000Z' },
                },
              ],
            },
            isLoading: false,
          };
        case 'my-day-tasks':
          return {
            data: {
              data: [
                {
                  id: 'task_1',
                  task_type: 'handoff_confirmation',
                  title: '申し送り確認',
                  priority: 'high',
                  status: 'pending',
                  due_date: null,
                  sla_due_at: null,
                  related_entity_type: 'visit_record',
                  related_entity_id: 'visit_record_1',
                },
              ],
            },
            isLoading: false,
          };
        case 'dashboard':
          return {
            data: emptyCockpit,
            isLoading: false,
          };
        case 'my-day-status-changes':
          return {
            data: [],
            isLoading: false,
          };
        default:
          throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
      }
    });
  });

  it('links pending tasks to their workflow destination', () => {
    render(<MyDayContent />);

    const taskLink = screen.getByRole('link', { name: /申し送り確認/ });
    expect(taskLink.getAttribute('href')).toEqual('/handoff');
    expect(screen.getByText('申し送り / 申し送りを確認')).toBeTruthy();
  });

  it('shows quick links to task and workflow workbenches', () => {
    render(<MyDayContent />);

    expect(screen.getByRole('link', { name: 'ダッシュボード' }).getAttribute('href')).toEqual(
      '/dashboard',
    );
    expect(screen.getByRole('link', { name: 'タスク' }).getAttribute('href')).toEqual('/tasks');
    expect(screen.getByRole('link', { name: 'ワークフロー' }).getAttribute('href')).toEqual(
      '/workflow',
    );
    expect(screen.getByRole('link', { name: '申し送り' }).getAttribute('href')).toEqual('/handoff');
    expect(screen.getByRole('link', { name: '通知' }).getAttribute('href')).toEqual(
      '/notifications',
    );
  });

  it('shows the home context banner and applies initial focus filters', () => {
    render(
      <MyDayContent
        initialFocus="visits"
        initialVisitFilter="unprepared"
        initialTaskFilter="urgent"
        initialContext="dashboard_home"
      />,
    );

    expect(screen.getByTestId('my-day-context-banner')).toBeTruthy();
    expect(screen.getByText('ホームから担当訪問にフォーカスして開いています。')).toBeTruthy();
    expect(screen.getByText('準備未完了のみ')).toBeTruthy();
    expect(screen.getByText('高優先のみ')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '準備未完了のみ' }).getAttribute('aria-pressed'),
    ).toEqual('true');
    expect(screen.getByRole('button', { name: '高優先のみ' }).getAttribute('aria-pressed')).toEqual(
      'true',
    );
    // 絞り込みは共有 FilterChipBar に集約され、名前付きグループとして提示される。
    expect(screen.getByRole('group', { name: '訪問の絞り込み' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'タスクの絞り込み' })).toBeTruthy();
    expect(screen.getByText('山田花子')).toBeTruthy();
    expect(screen.queryByText('佐藤次郎')).toBeNull();
  });

  it('shows a visible next step for unprepared visits', () => {
    render(<MyDayContent />);

    const overviewSection = screen.getByRole('heading', { name: '今日の概要' }).closest('section');
    const prioritySection = screen.getByRole('heading', { name: '優先対応' }).closest('section');

    expect(overviewSection?.textContent).toContain('次にすること');
    expect(prioritySection?.textContent).not.toContain('次にすること');
    expect(screen.getByText('次にすること')).toBeTruthy();
    expect(screen.getByText('訪問前準備を完了')).toBeTruthy();
    expect(screen.getByText(/1件の訪問で準備が未完了です/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /準備一覧を開く/ }).getAttribute('href')).toEqual(
      '/schedules',
    );
  });

  it('requests only open tasks assigned to the current user', async () => {
    render(<MyDayContent />);

    const tasksOptions = findQueryOptions('my-day-tasks');
    await tasksOptions.queryFn?.();

    expect(fetchAllCursorPagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/tasks',
        init: { headers: { 'x-org-id': 'org_1' } },
        errorMessage: 'タスクの取得に失敗しました',
      }),
    );
    const params = fetchAllCursorPagesMock.mock.calls[0]?.[0].params as URLSearchParams;
    expect(params.get('assigned_to')).toBe('user_1');
    expect(params.get('status')).toBe('open');
  });

  it('waits for the current user before fetching assigned visits and tasks', () => {
    mockCurrentUser({ id: null });

    render(<MyDayContent />);

    const visitsCall = useQueryMock.mock.calls.find(
      ([options]) => options.queryKey[0] === 'my-day-visits',
    );
    const tasksCall = useQueryMock.mock.calls.find(
      ([options]) => options.queryKey[0] === 'my-day-tasks',
    );

    expect(visitsCall?.[0].enabled).toEqual(false);
    expect(tasksCall?.[0].enabled).toEqual(false);
    expect(screen.queryByText('2件')).toBeNull();
    expect(screen.queryByText('1件')).toBeNull();
    expect(screen.queryByText('0件')).toBeNull();
    expect(screen.getAllByText('担当者情報を確認中').length).toBeGreaterThan(0);
  });

  it('folds completed visits into a collapsed scroll zone and keeps the primary list active-only', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return {
          data: {
            data: [
              {
                id: 'visit_active',
                case_: { patient: { name: '山田花子' } },
                visit_type: 'regular',
                time_window_start: '2026-04-10T09:00:00.000Z',
                time_window_end: '2026-04-10T10:00:00.000Z',
                schedule_status: 'planned',
                preparation: null,
              },
              {
                id: 'visit_done',
                case_: { patient: { name: '完了太郎' } },
                visit_type: 'regular',
                time_window_start: '2026-04-10T08:00:00.000Z',
                time_window_end: '2026-04-10T08:30:00.000Z',
                schedule_status: 'completed',
                preparation: { prepared_at: '2026-04-10T07:00:00.000Z' },
              },
            ],
          },
          isLoading: false,
          isError: false,
        };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: emptyCockpit, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return { data: [], isLoading: false, isError: false };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    // Pinned zone: 対象日が可視化される。
    expect(screen.getByText(/^本日 /)).toBeTruthy();
    // 完了訪問は折りたたみへ格納され、Primary の行リストには出ない。
    expect(screen.getByText('完了した訪問 1件')).toBeTruthy();
    const fold = screen.getByText('完了した訪問 1件').closest('details');
    expect(fold?.open).toBeFalsy();
    expect(screen.getByText('完了太郎').closest('details')).toBe(fold);
    // 未完了訪問は通常リスト(details 外)に出る。
    expect(screen.getByText('山田花子').closest('details')).toBeNull();
  });

  it('pins the JST business date even when the runtime timezone is behind Japan (SSOT 2.8)', () => {
    // date-fns format はランタイムローカル TZ で解釈するため、UTC instant を渡すと
    // Asia/Tokyo より遅れた TZ では前日化する。文字列成分からの構築で TZ 非依存にしたことを固定する。
    const originalTz = process.env.TZ;
    process.env.TZ = 'Pacific/Honolulu'; // UTC-10、JST より 19h 遅れ
    try {
      vi.useFakeTimers();
      // JST 2026-07-04 02:00 は Honolulu ではまだ 2026-07-03。業務日(JST)は 7/4(土)。
      vi.setSystemTime(new Date('2026-07-04T02:00:00+09:00'));
      // 前提確認: ランタイム TZ が実際に JST より遅れている(UTC instant のローカル日付が前日)。
      // これが 4 になる環境では TZ 差を再現できていないためテスト自体が壊れる(偽ガード検知)。
      expect(new Date('2026-07-04T00:00:00+09:00').getDate()).toBe(3);

      render(<MyDayContent />);

      // ラベルは JST 業務日(7/4 土)を示し、ローカル TZ による前日化(7/3 金)を起こさない。
      expect(screen.getByText('本日 7月4日(土)')).toBeTruthy();
      expect(screen.queryByText(/7月3日/)).toBeNull();
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
      vi.useRealTimers();
    }
  });

  it('never recommends a completed visit as the next step when only completed visits remain', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return {
          data: {
            data: [
              {
                id: 'visit_done',
                case_: { patient: { name: '完了太郎' } },
                visit_type: 'regular',
                time_window_start: '2026-04-10T09:00:00.000Z',
                time_window_end: '2026-04-10T10:00:00.000Z',
                schedule_status: 'completed',
                preparation: { prepared_at: '2026-04-10T08:00:00.000Z' },
              },
            ],
          },
          isLoading: false,
        };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: emptyCockpit, isLoading: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return { data: [], isLoading: false };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    // 完了訪問は Scroll 折りたたみに退避され、「次の訪問」に推薦されない。
    expect(screen.queryByText(/完了太郎さんの訪問を確認/)).toBeNull();
    // 未完了の訪問・タスクが無いので落ち着き状態の次の一手にフォールバックする。
    expect(screen.getByText('今日の確認は落ち着いています')).toBeTruthy();
  });

  it('surfaces the true audit total when the cockpit hides part of the queue', () => {
    const cockpitWithHiddenAudits = {
      ...emptyCockpit,
      audit_pending_count: 12,
      audit_queue_total_count: 12,
      audit_queue_visible_count: 1,
      audit_queue_hidden_count: 11,
      audit_queue: [
        {
          task_id: 'audit_1',
          cycle_id: 'cycle_1',
          patient_name: '監査花子',
          priority: 'urgent',
          due_at: null,
          intake_id: null,
          prescribed_date: null,
          handling_tags: [],
          has_narcotic: false,
          waiting_since: null,
        },
      ],
    };
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: cockpitWithHiddenAudits, isLoading: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return { data: [], isLoading: false };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    // 上位1件だけが緊急カードに載るが、総数と隠れ件数を明示して過小認識を防ぐ。
    expect(screen.getByText('監査花子さんの監査待ち')).toBeTruthy();
    expect(screen.getByText(/監査待ちは全部で12件です/)).toBeTruthy();
    expect(screen.getByText(/ほか11件を監査一覧で確認/)).toBeTruthy();
  });

  it('omits the audit total footer when nothing is hidden', () => {
    const cockpitNoHidden = {
      ...emptyCockpit,
      audit_pending_count: 1,
      audit_queue_total_count: 1,
      audit_queue_visible_count: 1,
      audit_queue_hidden_count: 0,
      audit_queue: [
        {
          task_id: 'audit_only',
          cycle_id: 'cycle_1',
          patient_name: '監査太郎',
          priority: 'urgent',
          due_at: null,
          intake_id: null,
          prescribed_date: null,
          handling_tags: [],
          has_narcotic: false,
          waiting_since: null,
        },
      ],
    };
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: cockpitNoHidden, isLoading: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return { data: [], isLoading: false };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    expect(screen.getByText('監査太郎さんの監査待ち')).toBeTruthy();
    expect(screen.queryByText(/監査待ちは全部で/)).toBeNull();
  });

  it('shows section errors instead of empty states when assigned visits fail to load', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return { data: undefined, isLoading: false, isError: true };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: emptyCockpit, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return { data: [], isLoading: false, isError: false };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    expect(screen.getByRole('alert', { name: '' })).toBeTruthy();
    expect(screen.getByText('本日の訪問を取得できません')).toBeTruthy();
    expect(screen.queryByText('本日の訪問はありません')).toBeNull();
    expect(screen.getByRole('link', { name: /スケジュールを確認/ }).getAttribute('href')).toEqual(
      '/schedules',
    );
  });

  it('shows section errors instead of empty states when assigned tasks fail to load', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: undefined, isLoading: false, isError: true };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: emptyCockpit, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return { data: [], isLoading: false, isError: false };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    expect(screen.getByText('未完了タスクを取得できません')).toBeTruthy();
    expect(screen.queryByText('未完了のタスクはありません')).toBeNull();
    expect(screen.getByRole('link', { name: /タスク一覧を確認/ }).getAttribute('href')).toEqual(
      '/tasks',
    );
  });

  it('keeps the next step in error mode when priority actions fail to load', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: undefined, isLoading: false, isError: true };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return { data: [], isLoading: false, isError: false };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    expect(screen.getByText('取得エラーがあります')).toBeTruthy();
    expect(screen.getByText('優先アクションを取得できません')).toBeTruthy();
    expect(screen.getByText('パイプラインを取得できません')).toBeTruthy();
    expect(screen.queryByText('今日の確認は落ち着いています')).toBeNull();
    expect(
      screen.getAllByRole('link', { name: /ワークフローを確認/ })[0]?.getAttribute('href'),
    ).toEqual('/workflow');
  });

  it('shows a supplemental error when status changes fail to load', () => {
    mockCurrentUser({ role: 'admin' });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: emptyCockpit, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return { data: undefined, isLoading: false, isError: true };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    expect(screen.getByText('ステータス変更を取得できません')).toBeTruthy();
    expect(screen.getByRole('link', { name: /患者一覧を確認/ }).getAttribute('href')).toEqual(
      '/patients',
    );
  });

  it('hides stale admin-only status changes for non-admin users', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: emptyCockpit, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return {
          data: [
            {
              id: 'audit_cached',
              target_id: 'patient_cached',
              changes: {
                from: 'stable',
                from_label: '安定',
                to: 'urgent',
                to_label: '要対応',
              },
              created_at: '2026-04-10T00:30:00.000Z',
            },
          ],
          isLoading: false,
          isError: true,
        };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    const statusChangesOptions = findQueryOptions('my-day-status-changes');
    expect(statusChangesOptions.enabled).toEqual(false);
    expect(screen.queryByText('ステータス変更を取得できません')).toBeNull();
    expect(screen.queryByText('ステータス変更を確認')).toBeNull();
    expect(screen.queryByText('安定 → 要対応')).toBeNull();
  });

  it('builds the admin status change query with an encoded JST day boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T08:00:00+09:00'));
    mockCurrentUser({ role: 'admin' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );

    render(<MyDayContent />);

    const statusChangesOptions = findQueryOptions('my-day-status-changes');
    expect(statusChangesOptions.enabled).toEqual(true);
    await statusChangesOptions.queryFn?.();

    const requestUrl = vi.mocked(fetch).mock.calls[0]?.[0] as string;
    expect(requestUrl).toContain('date_from=2026-04-10T00%3A00%3A00%2B09%3A00');
    expect(new URL(requestUrl, 'http://localhost').searchParams.get('date_from')).toEqual(
      '2026-04-10T00:00:00+09:00',
    );
  });

  it('renders status changes without requiring patient names in audit-log changes', () => {
    mockCurrentUser({ role: 'admin' });
    const hostilePatientId = 'patient/1?tab=x#frag';
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'my-day-visits') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-tasks') {
        return { data: { data: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'dashboard') {
        return { data: emptyCockpit, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'my-day-status-changes') {
        return {
          data: [
            {
              id: 'audit_1',
              target_id: hostilePatientId,
              changes: {
                from: 'stable',
                from_label: '安定',
                to: 'urgent',
                to_label: '要対応',
              },
              created_at: '2026-04-10T00:30:00.000Z',
            },
          ],
          isLoading: false,
          isError: false,
        };
      }
      throw new Error(`Unexpected query key: ${String(queryKey[0])}`);
    });

    render(<MyDayContent />);

    const statusChangeLink = screen.getByRole('link', { name: /ステータス変更を確認/ });
    const href = statusChangeLink.getAttribute('href') ?? '';
    expect(href).toEqual(`/patients/${encodeURIComponent(hostilePatientId)}`);
    expect(href).not.toContain('?tab=x');
    expect(href).not.toContain('#frag');
    expect(screen.getByText('安定 → 要対応')).toBeTruthy();
    expect(screen.queryByText('undefined')).toBeNull();
  });

  it('syncs visit focus changes back into the URL', async () => {
    render(
      <MyDayContent
        initialFocus="visits"
        initialVisitFilter="all"
        initialContext="dashboard_home"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '準備未完了のみ' }));

    expect(useRouterMock().replace).toHaveBeenCalledWith(
      '/my-day?context=dashboard_home&focus=visits&visit_filter=unprepared',
      { scroll: false },
    );
  });
});
