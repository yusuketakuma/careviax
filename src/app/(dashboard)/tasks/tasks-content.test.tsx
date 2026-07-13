// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { stubJsonFetch } from '@/test/fetch-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { PrimaryQueryError } from '@/lib/api/primary-query-json';
import type { BulkCompleteTasksResponse } from '@/lib/tasks/bulk-completion-contract';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useAuthStoreMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

vi.mock('@/components/ui/data-table', async () => {
  const { useState } = await import('react');
  return {
    DataTable: ({
      data,
      onSelectionChange,
      enablePagination,
      pageSize,
    }: {
      data: Array<{ title: string }>;
      onSelectionChange?: (rows: Array<{ title: string }>) => void;
      enablePagination?: boolean;
      pageSize?: number;
    }) => {
      // enablePagination 時のみ pageSize でクライアントページングする簡易モック
      // (実装の DataTable 内部挙動は data-table.test.tsx が担保する)。
      const [pageIndex, setPageIndex] = useState(0);
      const size = enablePagination ? (pageSize ?? data.length) : data.length;
      const pageCount = enablePagination ? Math.max(1, Math.ceil(data.length / size)) : 1;
      const visible = enablePagination
        ? data.slice(pageIndex * size, pageIndex * size + size)
        : data;

      return (
        <div>
          {onSelectionChange ? (
            <button type="button" onClick={() => onSelectionChange(data.slice(0, 2))}>
              テスト用に2件選択
            </button>
          ) : null}
          <div data-testid="tasks-table">{visible.map((item) => item.title).join(',')}</div>
          {enablePagination ? (
            <div>
              <span>
                {pageIndex + 1}/{pageCount}ページ
              </span>
              <button
                type="button"
                onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                disabled={pageIndex === 0}
              >
                前のページ
              </button>
              <button
                type="button"
                onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                disabled={pageIndex >= pageCount - 1}
              >
                次のページ
              </button>
            </div>
          ) : null}
        </div>
      );
    },
  };
});

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  type TriggerProps = { id?: string; className?: string; children?: React.ReactNode };
  type ItemProps = { value: string; children?: React.ReactNode };
  type MarkedComponent<P> = React.FC<P> & { selectMockSlot?: string };
  type TriggerElement = React.ReactElement<TriggerProps>;
  type ItemElement = React.ReactElement<ItemProps>;

  const SelectTriggerMock: MarkedComponent<TriggerProps> = () => null;
  SelectTriggerMock.selectMockSlot = 'trigger';
  const SelectContentMock: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <>{children}</>
  );
  const SelectItemMock: MarkedComponent<ItemProps> = () => null;
  SelectItemMock.selectMockSlot = 'item';

  function isTriggerElement(node: React.ReactNode): node is TriggerElement {
    return (
      React.isValidElement(node) &&
      typeof node.type === 'function' &&
      (node.type as MarkedComponent<TriggerProps>).selectMockSlot === 'trigger'
    );
  }

  function isItemElement(node: React.ReactNode): node is ItemElement {
    return (
      React.isValidElement(node) &&
      typeof node.type === 'function' &&
      (node.type as MarkedComponent<ItemProps>).selectMockSlot === 'item'
    );
  }

  function findTrigger(children: React.ReactNode): TriggerElement | null {
    for (const child of React.Children.toArray(children)) {
      if (isTriggerElement(child)) return child;
      if (React.isValidElement(child)) {
        const nested = findTrigger(
          (child as React.ReactElement<{ children?: React.ReactNode }>).props.children,
        );
        if (nested) return nested;
      }
    }
    return null;
  }

  function collectOptions(children: React.ReactNode): React.ReactNode[] {
    const options: React.ReactNode[] = [];
    for (const child of React.Children.toArray(children)) {
      if (isItemElement(child)) {
        options.push(
          <option key={child.props.value || 'empty'} value={child.props.value}>
            {child.props.children}
          </option>,
        );
      } else if (React.isValidElement(child)) {
        options.push(
          ...collectOptions(
            (child as React.ReactElement<{ children?: React.ReactNode }>).props.children,
          ),
        );
      }
    }
    return options;
  }

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => {
      const trigger = findTrigger(children);
      return (
        <select
          id={trigger?.props.id}
          className={trigger?.props.className}
          value={value ?? ''}
          onChange={(event) => onValueChange?.(event.currentTarget.value)}
        >
          <option value="" />
          {collectOptions(children)}
        </select>
      );
    },
    SelectContent: SelectContentMock,
    SelectItem: SelectItemMock,
    SelectTrigger: SelectTriggerMock,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder}</>,
  };
});

import { TasksContent } from './tasks-content';

setupDomTestEnv();

type BulkCompleteMutationOptions = {
  mutationFn: (ids: string[]) => Promise<BulkCompleteTasksResponse['data']>;
  onSuccess: (result: BulkCompleteTasksResponse['data']) => void;
};

type CreateRequestMutationOptions = {
  mutationFn: () => Promise<unknown>;
  onError: (error: unknown) => void;
};

function taskHealthBoardFixture() {
  return {
    generated_at: '2026-04-10T09:30:00.000Z',
    scope: 'role_default',
    scan: {
      statuses: ['pending', 'in_progress'],
      limit: 500,
      scanned_count: 500,
      truncated: true,
    },
    summary: {
      open_count: 500,
      overdue_count: 32,
      sla_overdue_count: 8,
      unassigned_count: 21,
      patient_safety_count: 5,
      billing_close_count: 3,
      report_delay_count: 4,
      risk_task_count: 16,
      stale_risk_task_count: 2,
      orphan_risk_task_count: 1,
    },
    task_type_groups: [
      {
        key: 'visit_preparation',
        label: 'visit_preparation',
        count: 12,
        urgent_count: 2,
        high_count: 4,
      },
    ],
    risk_domain_groups: [
      { key: 'medication', label: '薬剤', count: 7, urgent_count: 1, high_count: 2 },
      { key: 'billing', label: '請求', count: 3, urgent_count: 0, high_count: 1 },
    ],
    orphan_audit: {
      checked_count: 16,
      orphan_count: 1,
      reasons: [{ reason: 'missing_risk_key', count: 1 }],
      tasks: [
        {
          task_id: 'task_orphan',
          display_id: 'T-5001',
          task_type: 'risk_resolution_medication',
          priority: 'high',
          due_at: null,
          action_href: '/tasks?status=open&task_type=risk_resolution_medication',
        },
      ],
    },
    attention: {
      overdue_tasks: [
        {
          task_id: 'task_due',
          display_id: 'T-1024',
          task_type: 'visit_preparation',
          priority: 'high',
          due_at: '2026-04-10T08:00:00.000Z',
          action_href: '/tasks?status=open&task_type=visit_preparation',
        },
      ],
      sla_overdue_tasks: [
        {
          task_id: 'task_sla',
          display_id: 'T-2048',
          task_type: 'conference_action_item',
          priority: 'urgent',
          due_at: '2026-04-10T07:30:00.000Z',
          action_href: '/tasks?status=open&task_type=conference_action_item',
        },
      ],
      unassigned_tasks: [
        {
          task_id: 'task_unassigned',
          display_id: 'T-3096',
          task_type: 'report_delivery_followup',
          priority: 'normal',
          due_at: null,
          action_href: '/tasks?status=open&task_type=report_delivery_followup',
        },
      ],
      stale_risk_tasks: [],
    },
  };
}

function taskHealthBoardQueryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: taskHealthBoardFixture(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function healthBoardQueryKeys() {
  return useQueryMock.mock.calls
    .map((call) => call[0]?.queryKey)
    .filter((queryKey): queryKey is unknown[] => Array.isArray(queryKey))
    .filter((queryKey) => queryKey[0] === 'tasks-health-board');
}

function taskListQueryKeys() {
  return useQueryMock.mock.calls
    .map((call) => call[0]?.queryKey)
    .filter((queryKey): queryKey is unknown[] => Array.isArray(queryKey))
    .filter((queryKey) => queryKey[0] === 'tasks');
}

function getCreateRequestMutationOptions() {
  const options = useMutationMock.mock.calls
    .map((call) => call[0] as CreateRequestMutationOptions | undefined)
    .filter((candidate) => candidate?.mutationFn.length === 0)
    .at(-1);
  expect(options).toBeTruthy();
  return options as CreateRequestMutationOptions;
}

function getBulkCompleteMutationOptions() {
  const options = useMutationMock.mock.calls[1]?.[0] as BulkCompleteMutationOptions | undefined;
  expect(options).toBeTruthy();
  return options as BulkCompleteMutationOptions;
}

describe('TasksContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/tasks');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    useAuthStoreMock.mockImplementation(
      (selector: (state: { currentUser: { id: string; role: 'owner' } }) => unknown) =>
        selector({ currentUser: { id: 'user_1', role: 'owner' } }),
    );
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return {
          data: {
            data: [
              {
                id: 'user_2',
                name: '佐藤 薬剤師',
                role: 'pharmacist',
                role_label: '薬剤師',
                assignable_work_request_types: [
                  'staff_work_request_visit',
                  'staff_work_request_audit',
                  'staff_work_request_general',
                ],
                open_task_count: 2,
                today_visit_count: 1,
                dispense_task_count: 1,
                workload_score: 7,
                visits: [
                  {
                    id: 'visit_1',
                    patient_name: '山田 花子',
                    visit_type: 'home',
                    schedule_status: 'scheduled',
                    time_start: '2026-04-10T09:00:00.000Z',
                    time_end: '2026-04-10T09:30:00.000Z',
                  },
                ],
                open_tasks: [
                  {
                    id: 'task_2',
                    title: '監査依頼',
                    task_type: 'staff_work_request_audit',
                    priority: 'normal',
                    status: 'pending',
                    due_date: null,
                    sla_due_at: null,
                  },
                ],
              },
            ],
          },
          isLoading: false,
        };
      }

      return {
        data: {
          data: [
            {
              id: 'task_1',
              task_type: 'visit_preparation',
              title: '訪問準備',
              description: null,
              status: 'pending',
              priority: 'high',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'visit_schedule',
              related_entity_id: 'schedule_1',
              completed_at: null,
              created_at: '2026-04-10T08:00:00.000Z',
            },
            {
              id: 'task_2',
              task_type: 'follow_up_call',
              title: 'フォロー電話',
              description: null,
              status: 'pending',
              priority: 'normal',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'patient',
              related_entity_id: 'patient_1',
              completed_at: null,
              created_at: '2026-04-10T08:10:00.000Z',
            },
          ],
        },
        isLoading: false,
      };
    });
  });

  it('shows the home context banner and seeds initial filters', () => {
    render(
      <TasksContent initialAssigned="me" initialStatus="pending" initialContext="dashboard_home" />,
    );

    expect(screen.getByTestId('tasks-context-banner')).toBeTruthy();
    expect(
      screen.getByText('ホームから自分担当の未完了タスクにフォーカスして開いています。'),
    ).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['tasks', 'org_1', 'status=pending&assigned_to=user_1'],
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['tasks-health-board', 'org_1', '/api/tasks/health-board?scope=mine&limit=500'],
      }),
    );
    expect(screen.getByTestId('staff-workload-board')).toBeTruthy();
    expect(screen.getByText('佐藤 薬剤師')).toBeTruthy();
    expect(screen.getByText('訪問: 山田 花子')).toBeTruthy();
    expect(screen.getByText('依頼: 監査依頼')).toBeTruthy();
    const immediateSection = screen.getByRole('heading', { name: '今すぐ処理' }).closest('section');
    expect(immediateSection).toBeTruthy();
    expect(within(immediateSection as HTMLElement).getByText('表示件数 2件')).toBeTruthy();
    expect(
      within(immediateSection as HTMLElement)
        .getByRole('link', { name: '一覧へ移動' })
        .getAttribute('href'),
    ).toBe('#tasks-list');
    expect(
      within(immediateSection as HTMLElement).getByRole('link', { name: 'My Day' }),
    ).toBeTruthy();
    expect(
      within(immediateSection as HTMLElement).getByRole('link', { name: 'ワークフロー' }),
    ).toBeTruthy();
    expect(screen.getByTestId('tasks-table').textContent).toContain('訪問準備');
  });

  it('shows the operational task health board without exposing task descriptions or metadata', () => {
    render(<TasksContent />);

    const healthBoardSection = screen
      .getByRole('heading', { name: 'オペレーショナル タスクヘルスボード' })
      .closest('section');
    expect(healthBoardSection).toBeTruthy();
    const healthBoard = within(healthBoardSection as HTMLElement);

    expect(healthBoard.getByRole('combobox', { name: 'ヘルス範囲' })).toBeTruthy();
    expect(healthBoard.getByRole('combobox', { name: 'リスク領域' })).toBeTruthy();
    expect(healthBoard.getByText('ヘルス集計条件')).toBeTruthy();
    expect(
      healthBoard.getByText('先頭500件で集計 / 未読込あり。件数はスキャン範囲内の下限です。'),
    ).toBeTruthy();
    expect(healthBoard.getAllByText('SLA超過').length).toBeGreaterThanOrEqual(1);
    expect(healthBoard.getByText('患者安全')).toBeTruthy();
    expect(healthBoard.getByTestId('task-health-metric-SLA超過').textContent).toContain('8');
    expect(healthBoard.getByTestId('task-health-metric-孤児リスク').textContent).toContain('1');
    expect(healthBoard.getByText('薬剤')).toBeTruthy();
    expect(healthBoard.getByText('T-2048')).toBeTruthy();
    expect(healthBoard.getByText('PHIを含まない参照だけ表示')).toBeTruthy();
    expect(healthBoard.queryByText('metadata')).toBeNull();
    expect(healthBoard.queryByText('dedupe')).toBeNull();
  });

  it('uses an explicit health-board retry instead of a false-empty panel when health fetch fails', () => {
    const refetchHealthBoard = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult({
          data: undefined,
          isError: true,
          refetch: refetchHealthBoard,
        });
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<TasksContent />);

    const healthBoardSection = screen
      .getByRole('heading', { name: 'オペレーショナル タスクヘルスボード' })
      .closest('section');
    expect(healthBoardSection).toBeTruthy();
    const healthBoard = within(healthBoardSection as HTMLElement);
    expect(
      healthBoard.getByText(
        'タスクヘルスボードを取得できませんでした。表示済み一覧の0件とは扱わず、再読み込みしてください。',
      ),
    ).toBeTruthy();
    expect(healthBoard.queryByText('スキャン対象に未処理タスクはありません。')).toBeNull();

    fireEvent.click(healthBoard.getByRole('button', { name: 'ヘルス再読み込み' }));
    expect(refetchHealthBoard).toHaveBeenCalledTimes(1);
  });

  it('loads the task health board through the org header helper and API path helper', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValueOnce(sentinelHeaders);
    const healthPayload = { data: taskHealthBoardFixture() };
    const fetchMock = stubJsonFetch(healthPayload);
    let healthBoardQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation(
      (options: { queryKey?: unknown[]; queryFn?: () => unknown }) => {
        if (options.queryKey?.[0] === 'tasks-health-board') {
          healthBoardQueryFn = options.queryFn as (() => Promise<unknown>) | undefined;
          return taskHealthBoardQueryResult();
        }
        if (options.queryKey?.[0] === 'staff-workload') {
          return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
        }
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      },
    );

    render(<TasksContent initialTaskType="conference_action_item" />);

    expect(healthBoardQueryFn).toBeTruthy();
    await expect(healthBoardQueryFn?.()).resolves.toEqual(healthPayload.data);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks/health-board?scope=role_default&limit=500&task_type=conference_action_item',
      {
        headers: sentinelHeaders,
      },
    );
    expect(buildOrgHeaders).toHaveBeenCalledWith('org_1');
  });

  it('filters the health board by risk domain without sending the inherited task type', async () => {
    render(<TasksContent initialTaskType="conference_action_item" />);

    expect(healthBoardQueryKeys()).toContainEqual([
      'tasks-health-board',
      'org_1',
      '/api/tasks/health-board?scope=role_default&limit=500&task_type=conference_action_item',
    ]);

    fireEvent.change(screen.getByRole('combobox', { name: 'リスク領域' }), {
      target: { value: 'medication' },
    });

    await waitFor(() => {
      expect(healthBoardQueryKeys()).toContainEqual([
        'tasks-health-board',
        'org_1',
        '/api/tasks/health-board?scope=role_default&limit=500&risk_domain=medication',
      ]);
    });
    expect(
      healthBoardQueryKeys().some(
        (queryKey) =>
          String(queryKey[2]).includes('risk_domain=medication') &&
          String(queryKey[2]).includes('task_type=conference_action_item'),
      ),
    ).toBe(false);
    const healthBoardSection = screen
      .getByRole('heading', { name: 'オペレーショナル タスクヘルスボード' })
      .closest('section');
    expect(healthBoardSection).toBeTruthy();
    expect(
      within(healthBoardSection as HTMLElement).getByText(
        '一覧の種別フィルタとは独立して集計します。',
      ),
    ).toBeTruthy();
  });

  it('changes the health board team scope without mutating the task-list assigned filter', async () => {
    render(<TasksContent initialAssigned="me" initialStatus="pending" />);

    expect(taskListQueryKeys()).toContainEqual([
      'tasks',
      'org_1',
      'status=pending&assigned_to=user_1',
    ]);
    expect(healthBoardQueryKeys()).toContainEqual([
      'tasks-health-board',
      'org_1',
      '/api/tasks/health-board?scope=mine&limit=500',
    ]);

    fireEvent.change(screen.getByRole('combobox', { name: 'ヘルス範囲' }), {
      target: { value: 'team' },
    });

    await waitFor(() => {
      expect(healthBoardQueryKeys()).toContainEqual([
        'tasks-health-board',
        'org_1',
        '/api/tasks/health-board?scope=team&limit=500',
      ]);
    });
    expect(taskListQueryKeys()).toContainEqual([
      'tasks',
      'org_1',
      'status=pending&assigned_to=user_1',
    ]);
    expect(taskListQueryKeys().some((queryKey) => String(queryKey[2]) === 'status=pending')).toBe(
      false,
    );
  });

  it('keeps new health board filter controls at the 44px touch target size', () => {
    render(<TasksContent />);

    for (const name of ['ヘルス範囲', 'リスク領域']) {
      const trigger = screen.getByRole('combobox', { name });
      expect(trigger.className).toContain('!min-h-[44px]');
      expect(trigger.className).toContain('sm:!min-h-[44px]');
    }
  });

  it('shows SegmentError (not a false-empty list) with retry when the tasks query fails', () => {
    const refetch = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      // タスク取得失敗 → 空一覧(false-empty)・偽の0件ではなく SegmentError + 再読み込み。
      return { data: undefined, isLoading: false, isError: true, refetch };
    });

    render(<TasksContent />);

    expect(screen.getByRole('heading', { name: 'タスク一覧を表示できません' })).toBeTruthy();
    expect(screen.getByText(/タスクを取得できませんでした/)).toBeTruthy();
    expect(screen.getByText(/時間をおいて再読み込みしてください/)).toBeTruthy();
    expect(screen.queryByTestId('tasks-table')).toBeNull();
    expect(screen.queryByText('該当するタスクはありません')).toBeNull();
    expect(screen.queryByText(/storage_key|token=|patient_name|\/api\/tasks/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('counts urgent tasks in the immediate priority summary', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      return {
        data: {
          data: [
            {
              id: 'task_urgent',
              task_type: 'visit_preparation',
              title: '緊急訪問準備',
              description: null,
              status: 'pending',
              priority: 'urgent',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'visit_schedule',
              related_entity_id: 'schedule_1',
              completed_at: null,
              created_at: '2026-04-10T08:00:00.000Z',
            },
            {
              id: 'task_high',
              task_type: 'handoff_confirmation',
              title: '高優先申し送り',
              description: null,
              status: 'pending',
              priority: 'high',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'visit_record',
              related_entity_id: 'visit_record_1',
              completed_at: null,
              created_at: '2026-04-10T08:05:00.000Z',
            },
            {
              id: 'task_normal',
              task_type: 'follow_up_call',
              title: '通常フォロー',
              description: null,
              status: 'pending',
              priority: 'normal',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'patient',
              related_entity_id: 'patient_1',
              completed_at: null,
              created_at: '2026-04-10T08:10:00.000Z',
            },
          ],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    });

    render(<TasksContent />);

    const immediateSection = screen.getByRole('heading', { name: '今すぐ処理' }).closest('section');
    expect(immediateSection).toBeTruthy();
    expect(within(immediateSection as HTMLElement).getByText('緊急・高優先度 2件')).toBeTruthy();
    expect(within(immediateSection as HTMLElement).queryByText('高優先度 1件')).toBeNull();
  });

  it('shows a retry instead of a false-empty staff workload board when that query fails', () => {
    const refetchStaffWorkload = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        // スタッフ別業務量の取得失敗 → 「依頼可能なスタッフがいない」かのような false-empty を出さない。
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          isRefetchError: false,
          error: new PrimaryQueryError('スタッフ別業務量の取得に失敗しました', null, true),
          refetch: refetchStaffWorkload,
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<TasksContent />);

    expect(screen.getByText('スタッフ別業務量を取得できませんでした。')).toBeTruthy();
    expect(within(screen.getByTestId('staff-workload-board')).getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('依頼可能なスタッフが見つかりません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchStaffWorkload).toHaveBeenCalledTimes(1);
  });

  it('keeps stale workload visible but disables every assignment path after a refetch error', async () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return {
          data: {
            data: [
              {
                id: 'pharmacist_1',
                name: '山田 薬剤師',
                role: 'pharmacist',
                role_label: '薬剤師',
                assignable_work_request_types: [
                  'staff_work_request_visit',
                  'staff_work_request_audit',
                  'staff_work_request_general',
                ],
                open_task_count: 2,
                today_visit_count: 1,
                dispense_task_count: 1,
                workload_score: 7,
                visits: [],
                open_tasks: [],
              },
            ],
          },
          isLoading: false,
          isError: true,
          isRefetchError: true,
          dataUpdatedAt: Date.now() - 5 * 60_000,
          error: new PrimaryQueryError('スタッフ別業務量の取得に失敗しました', 503, true),
          refetch: vi.fn(),
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<TasksContent />);

    expect(screen.getByText('山田 薬剤師')).toBeTruthy();
    const workloadCard = screen.getByRole('button', { name: /山田 薬剤師/ });
    expect(workloadCard.getAttribute('aria-disabled')).toBe('true');
    expect(workloadCard.getAttribute('aria-describedby')?.split(' ')).toContain(
      'staff-workload-error',
    );
    expect(
      screen.getByText('スタッフ情報を再取得するまで、この依頼先は選択できません'),
    ).toBeTruthy();
    const staleNotice = screen.getByText(/前回取得データを読み取り専用で表示しています/);
    expect(staleNotice.textContent).toContain('5分前のデータ');
    expect(staleNotice.textContent).toContain('最終更新:');
    expect(
      within(screen.getByRole('combobox', { name: '依頼先' })).queryByRole('option', {
        name: /山田 薬剤師/,
      }),
    ).toBeNull();
    const submitButton = screen.getByTestId('staff-work-request-submit');
    expect(submitButton).toHaveProperty('disabled', true);
    expect(submitButton.getAttribute('aria-describedby')).toBe(
      'staff-work-request-submit-disabled-reason',
    );
    expect(screen.getByText('スタッフ情報を再取得するまで依頼できません')).toBeTruthy();
    await expect(getCreateRequestMutationOptions().mutationFn()).rejects.toThrow(
      '基本権限上、この依頼を割り当てられるスタッフを選択してください',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides cached workload PHI when a refetch confirms access is no longer allowed', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return {
          data: {
            data: [
              {
                id: 'pharmacist_1',
                name: '失効後に隠すスタッフ名',
                role: 'pharmacist',
                role_label: '薬剤師',
                assignable_work_request_types: ['staff_work_request_visit'],
                open_task_count: 1,
                today_visit_count: 1,
                dispense_task_count: 0,
                workload_score: 4,
                visits: [{ id: 'visit_1', patient_name: '失効後に隠す患者名' }],
                open_tasks: [{ id: 'task_1', title: '失効後に隠すタスク件名' }],
              },
            ],
            meta: { date: '2026-07-13' },
          },
          isLoading: false,
          isError: true,
          isRefetchError: true,
          error: new PrimaryQueryError('スタッフ別業務量の取得に失敗しました', 403, false),
          refetch: vi.fn(),
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<TasksContent />);

    expect(screen.getByText('スタッフ別業務量を取得できませんでした。')).toBeTruthy();
    expect(screen.queryByText('失効後に隠すスタッフ名')).toBeNull();
    expect(screen.queryByText('訪問: 失効後に隠す患者名')).toBeNull();
    expect(screen.queryByText('依頼: 失効後に隠すタスク件名')).toBeNull();
    expect(screen.getByTestId('staff-work-request-submit')).toHaveProperty('disabled', true);
  });

  it('shows a named skeleton instead of a plain loading text for staff workload', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return {
          data: undefined,
          isLoading: true,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<TasksContent />);

    expect(screen.getByRole('status', { name: 'スタッフ別業務量を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('スタッフ別業務量を読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('スタッフ別業務量を取得できませんでした。')).toBeNull();
    expect(screen.queryByText('依頼可能なスタッフが見つかりません')).toBeNull();
  });

  it('loads staff workload through the org header helper and returns the response envelope', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValueOnce(sentinelHeaders);
    const workloadPayload = { data: [], meta: { date: '2026-04-10' } };
    const fetchMock = stubJsonFetch(workloadPayload);
    let staffWorkloadQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation(
      (options: { queryKey?: unknown[]; queryFn?: () => unknown }) => {
        if (options.queryKey?.[0] === 'tasks-health-board') {
          return taskHealthBoardQueryResult();
        }
        if (options.queryKey?.[0] === 'staff-workload') {
          staffWorkloadQueryFn = options.queryFn as (() => Promise<unknown>) | undefined;
        }
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      },
    );

    render(<TasksContent />);

    expect(staffWorkloadQueryFn).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['staff-workload', 'org_1', 'user_1', 'owner'],
        enabled: true,
      }),
    );
    await expect(staffWorkloadQueryFn?.()).resolves.toEqual(workloadPayload);
    expect(fetchMock).toHaveBeenCalledWith('/api/staff-workload', {
      headers: sentinelHeaders,
    });
    expect(buildOrgHeaders).toHaveBeenCalledWith('org_1');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], date: '2026-04-10' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(staffWorkloadQueryFn?.()).rejects.toThrow('スタッフ別業務量の取得に失敗しました');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(staffWorkloadQueryFn?.()).rejects.toMatchObject({
      status: 403,
      canRetainCachedData: false,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'user_2',
              name: '契約外ロール',
              role: 'superuser',
              role_label: '不正',
              assignable_work_request_types: [],
              open_task_count: 0,
              today_visit_count: 0,
              dispense_task_count: 0,
              workload_score: 0,
              visits: [],
              open_tasks: [],
            },
          ],
          meta: { date: '2026-04-10' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(staffWorkloadQueryFn?.()).rejects.toMatchObject({
      status: 200,
      canRetainCachedData: false,
    });
  });

  it('prefills work request fields from visit or audit deep links', () => {
    render(
      <TasksContent
        initialWorkRequestType="staff_work_request_audit"
        initialWorkRequestTitle="田中さんの監査をしてほしい"
        initialWorkRequestDescription="14:00訪問前に完了"
        initialRelatedEntityType="dispense_task"
        initialRelatedEntityId="task-tanaka"
      />,
    );

    expect(screen.getByRole('combobox', { name: '依頼内容' })).toHaveProperty(
      'value',
      'staff_work_request_audit',
    );
    expect(screen.getAllByText('通常').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue('田中さんの監査をしてほしい')).toBeTruthy();
    expect(screen.getByDisplayValue('14:00訪問前に完了')).toBeTruthy();
    expect(screen.getByText('対象の監査タスクに紐づけて依頼します。')).toBeTruthy();
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [
          'tasks',
          'org_1',
          'status=pending&related_entity_type=dispense_task&related_entity_id=task-tanaka',
        ],
      }),
    );
  });

  it('filters assignees by the provider projection and clears a stale selection on type change', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return {
          data: {
            data: [
              {
                id: 'trainee_1',
                name: '佐藤 研修薬剤師',
                role: 'pharmacist_trainee',
                role_label: '研修薬剤師',
                assignable_work_request_types: [
                  'staff_work_request_visit',
                  'staff_work_request_general',
                ],
                open_task_count: 1,
                today_visit_count: 0,
                dispense_task_count: 0,
                workload_score: 1,
                visits: [],
                open_tasks: [],
              },
              {
                id: 'pharmacist_1',
                name: '山田 薬剤師',
                role: 'pharmacist',
                role_label: '薬剤師',
                assignable_work_request_types: [
                  'staff_work_request_visit',
                  'staff_work_request_audit',
                  'staff_work_request_general',
                ],
                open_task_count: 2,
                today_visit_count: 0,
                dispense_task_count: 0,
                workload_score: 2,
                visits: [],
                open_tasks: [],
              },
              {
                id: 'clerk_1',
                name: '鈴木 事務',
                role: 'clerk',
                role_label: '事務スタッフ',
                assignable_work_request_types: [],
                open_task_count: 0,
                today_visit_count: 0,
                dispense_task_count: 0,
                workload_score: 0,
                visits: [],
                open_tasks: [],
              },
            ],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<TasksContent />);

    const assigneeSelect = screen.getByRole('combobox', { name: '依頼先' });
    expect(within(assigneeSelect).getByRole('option', { name: /佐藤 研修薬剤師/ })).toBeTruthy();
    expect(within(assigneeSelect).getByRole('option', { name: /山田 薬剤師/ })).toBeTruthy();
    expect(within(assigneeSelect).queryByRole('option', { name: /鈴木 事務/ })).toBeNull();
    const clerkCard = screen.getByRole('button', { name: /鈴木 事務/ });
    expect(clerkCard.getAttribute('aria-disabled')).toBe('true');
    expect(within(clerkCard).getByText('基本権限上、この依頼は割り当てできません')).toBeTruthy();
    fireEvent.click(clerkCard);
    expect(assigneeSelect).toHaveProperty('value', '');

    fireEvent.change(assigneeSelect, { target: { value: 'trainee_1' } });
    expect(assigneeSelect).toHaveProperty('value', 'trainee_1');

    fireEvent.change(screen.getByRole('combobox', { name: '依頼内容' }), {
      target: { value: 'staff_work_request_audit' },
    });

    expect(
      screen.getByText(
        '自己監査と二者確認の可否は、監査ワークフローで対象タスクごとに別途判定されます。',
      ),
    ).toBeTruthy();
    expect(assigneeSelect).toHaveProperty('value', '');
    expect(within(assigneeSelect).queryByRole('option', { name: /佐藤 研修薬剤師/ })).toBeNull();
    expect(within(assigneeSelect).getByRole('option', { name: /山田 薬剤師/ })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /佐藤 研修薬剤師/ }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(screen.getByTestId('staff-work-request-submit')).toHaveProperty('disabled', true);
  });

  it('clears the selected assignee when the org or authenticated actor fingerprint changes', async () => {
    let authState: { currentUser: { id: string; role: 'owner' | 'admin' } } = {
      currentUser: { id: 'user_1', role: 'owner' },
    };
    useAuthStoreMock.mockImplementation((selector: (state: typeof authState) => unknown) =>
      selector(authState),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const rendered = render(<TasksContent />);
    let assigneeSelect = screen.getByRole('combobox', { name: '依頼先' });

    fireEvent.change(assigneeSelect, { target: { value: 'user_2' } });
    expect(assigneeSelect).toHaveProperty('value', 'user_2');

    authState = { currentUser: { id: 'user_1', role: 'admin' } };
    rendered.rerender(<TasksContent />);

    assigneeSelect = screen.getByRole('combobox', { name: '依頼先' });
    expect(assigneeSelect).toHaveProperty('value', '');
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['staff-workload', 'org_1', 'user_1', 'admin'],
      }),
    );

    fireEvent.change(assigneeSelect, { target: { value: 'user_2' } });
    expect(assigneeSelect).toHaveProperty('value', 'user_2');

    authState = { currentUser: { id: 'user_3', role: 'owner' } };
    useOrgIdMock.mockReturnValue('org_2');
    rendered.rerender(<TasksContent />);

    assigneeSelect = screen.getByRole('combobox', { name: '依頼先' });
    expect(assigneeSelect).toHaveProperty('value', '');
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['staff-workload', 'org_2', 'user_3', 'owner'],
      }),
    );
    await expect(getCreateRequestMutationOptions().mutationFn()).rejects.toThrow(
      '基本権限上、この依頼を割り当てられるスタッフを選択してください',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed without POST when the provider exposes no assignable staff', async () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return {
          data: {
            data: [
              {
                id: 'clerk_1',
                name: '鈴木 事務',
                role: 'clerk',
                role_label: '事務スタッフ',
                assignable_work_request_types: [],
                open_task_count: 0,
                today_visit_count: 0,
                dispense_task_count: 0,
                workload_score: 0,
                visits: [],
                open_tasks: [],
              },
            ],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<TasksContent />);

    expect(
      screen.getByText('基本権限上、この依頼を割り当てられるスタッフが見つかりません。'),
    ).toBeTruthy();
    expect(screen.getByTestId('staff-work-request-submit')).toHaveProperty('disabled', true);
    await expect(getCreateRequestMutationOptions().mutationFn()).rejects.toThrow(
      '基本権限上、この依頼を割り当てられるスタッフを選択してください',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses safe recovery copy and rejects legacy successful work request responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: '業務依頼の作成権限がありません' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: '業務を依頼しました' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<TasksContent />);

    fireEvent.change(screen.getByRole('combobox', { name: '依頼先' }), {
      target: { value: 'user_2' },
    });
    fireEvent.change(screen.getByLabelText('件名'), {
      target: { value: '担当資格のあるスタッフへ依頼' },
    });

    const createRequestOptions = getCreateRequestMutationOptions();
    let rejectedError: unknown;
    try {
      await createRequestOptions.mutationFn();
    } catch (error) {
      rejectedError = error;
    }
    expect(rejectedError).toMatchObject({
      status: 403,
      outcomeUnknown: false,
      assignmentEligibilityRejected: false,
    });
    await act(async () => {
      createRequestOptions.onError(rejectedError);
    });

    expect(fetch).toHaveBeenCalledWith('/api/tasks', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: expect.any(String),
    });
    expect(toast.error).toHaveBeenCalledWith('業務依頼の作成に失敗しました');
    expect(toast.error).not.toHaveBeenCalledWith('業務依頼の作成権限がありません');
    expect(screen.getByRole('combobox', { name: '依頼先' })).toHaveProperty('value', 'user_2');
    expect(
      screen.getByText(
        '依頼は作成されませんでした。入力内容、対象業務、現在の権限を確認して再送してください。',
      ),
    ).toBeTruthy();

    await expect(createRequestOptions.mutationFn()).rejects.toMatchObject({
      status: 201,
      outcomeUnknown: true,
      assignmentEligibilityRejected: false,
    });
  });

  it('reuses one dedupe key after response loss so a retry cannot create a duplicate task', async () => {
    const invalidateQueriesMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network response lost'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'task_1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<TasksContent />);
    fireEvent.change(screen.getByRole('combobox', { name: '依頼先' }), {
      target: { value: 'user_2' },
    });
    fireEvent.change(screen.getByLabelText('件名'), {
      target: { value: '応答喪失でも重複しない依頼' },
    });

    const createRequestOptions = getCreateRequestMutationOptions();
    let unknownOutcomeError: unknown;
    try {
      await createRequestOptions.mutationFn();
    } catch (error) {
      unknownOutcomeError = error;
    }
    expect(unknownOutcomeError).toMatchObject({
      status: 0,
      outcomeUnknown: true,
      assignmentEligibilityRejected: false,
    });
    await act(async () => {
      createRequestOptions.onError(unknownOutcomeError);
    });

    expect(screen.getByText(/通信の途中で送信結果を確認できませんでした/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '依頼先' })).toHaveProperty('value', 'user_2');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['tasks', 'org_1'] });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['tasks-health-board', 'org_1'],
    });

    await expect(createRequestOptions.mutationFn()).resolves.toBeUndefined();
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      dedupe_key: string;
    };
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      dedupe_key: string;
    };
    expect(firstBody.dedupe_key).toMatch(/^staff-work-request:/);
    expect(secondBody.dedupe_key).toBe(firstBody.dedupe_key);
  });

  it('locks assignment and persistently refreshes candidates after a create-time eligibility drift', async () => {
    const invalidateQueriesMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
    const baseUseQueryImplementation = useQueryMock.getMockImplementation();
    let staffDataUpdatedAt = 100;
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const result = baseUseQueryImplementation?.(options) as Record<string, unknown>;
      return options.queryKey?.[0] === 'staff-workload'
        ? { ...result, dataUpdatedAt: staffDataUpdatedAt }
        : result;
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          message: '依頼先スタッフはこのタスク種別を担当できません',
          details: {
            reason: 'task_assignee_ineligible',
            assigned_to: ['このタスク種別を担当できるスタッフを選択してください'],
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rendered = render(<TasksContent />);
    fireEvent.change(screen.getByRole('combobox', { name: '依頼先' }), {
      target: { value: 'user_2' },
    });
    fireEvent.change(screen.getByLabelText('件名'), {
      target: { value: '権限変更を検知する依頼' },
    });

    const createRequestOptions = getCreateRequestMutationOptions();
    let eligibilityError: unknown;
    try {
      await createRequestOptions.mutationFn();
    } catch (error) {
      eligibilityError = error;
    }
    expect(eligibilityError).toMatchObject({
      status: 400,
      outcomeUnknown: false,
      assignmentEligibilityRejected: true,
    });
    await act(async () => {
      createRequestOptions.onError(eligibilityError);
    });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['staff-workload', 'org_1'],
    });
    expect(screen.getByRole('combobox', { name: '依頼先' })).toHaveProperty('value', '');
    expect(
      screen.getByText(
        '業務依頼を作成できませんでした。割当候補が変わった可能性があるため、再読み込みして依頼先を選び直してください。',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('staff-work-request-submit')).toHaveProperty('disabled', true);
    const recoveryCard = screen.getByRole('button', { name: /佐藤 薬剤師/ });
    expect(recoveryCard.getAttribute('aria-describedby')?.split(' ')).toContain(
      'work-request-assignment-recovery',
    );
    expect(
      screen.getByText('割当候補の再確認が完了するまで、この依頼先は選択できません'),
    ).toBeTruthy();
    await expect(getCreateRequestMutationOptions().mutationFn()).rejects.toThrow(
      '基本権限上、この依頼を割り当てられるスタッフを選択してください',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '割当候補を再読み込み' }));
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(2);

    staffDataUpdatedAt = 200;
    rendered.rerender(<TasksContent />);
    expect(screen.queryByText(/割当候補が変わった可能性/)).toBeNull();
    expect(
      within(screen.getByRole('combobox', { name: '依頼先' })).getByRole('option', {
        name: /佐藤 薬剤師/,
      }),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: '依頼先' })).toHaveProperty('value', '');
  });

  it('surfaces server-provided bulk completion failure details', async () => {
    const invalidateQueriesMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              total: 2,
              completed: 1,
              failed: 1,
              failures: [
                {
                  id: 'task_2',
                  code: 'dedicated_completion_required',
                  message: 'このタスクは専用画面で完了してください',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    render(<TasksContent />);

    const bulkCompleteOptions = getBulkCompleteMutationOptions();

    const result = await bulkCompleteOptions.mutationFn(['task_1', 'task_2']);
    await act(async () => {
      bulkCompleteOptions.onSuccess(result);
    });

    expect(fetch).toHaveBeenCalledWith('/api/tasks/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify({ ids: ['task_1', 'task_2'] }),
    });
    expect(toast.warning).toHaveBeenCalledWith('1件完了、1件失敗しました', {
      description: '失敗理由: このタスクは専用画面で完了してください',
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['tasks', 'org_1'] });
  });

  it('rejects malformed successful bulk completion envelopes without invalidating task caches', async () => {
    const invalidateQueriesMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              total: 2,
              completed: 1,
              failed: 1,
              failures: 'bad-shape',
            },
          }),
          { status: 200 },
        ),
      ),
    );

    render(<TasksContent />);

    const bulkCompleteOptions = getBulkCompleteMutationOptions();

    await expect(bulkCompleteOptions.mutationFn(['task_1', 'task_2'])).rejects.toThrow(
      'タスク更新に失敗しました',
    );

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it('keeps selected tasks when a malformed bulk completion success is rejected', async () => {
    const invalidateQueriesMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
    useMutationMock.mockImplementation(
      (options: {
        mutationFn: (payload: unknown) => Promise<unknown>;
        onSuccess?: (result: unknown) => void;
        onError?: (error: unknown) => void;
      }) => ({
        mutate: (payload: unknown) => {
          void options
            .mutationFn(payload)
            .then((result) => options.onSuccess?.(result))
            .catch((error: unknown) => options.onError?.(error));
        },
        isPending: false,
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              total: 2,
              completed: 1,
              failed: 1,
              failures: 'bad-shape',
            },
          }),
          { status: 200 },
        ),
      ),
    );

    render(<TasksContent />);

    fireEvent.click(screen.getByRole('button', { name: 'テスト用に2件選択' }));
    expect(screen.getByText('選択中 2件')).toBeTruthy();
    const bulkCompleteButton = screen.getByRole('button', {
      name: '表示中から選択した2件を完了',
    });
    expect(
      screen.getByText('一括完了の対象は現在表示中の読込済み行から選択したタスクです。'),
    ).toBeTruthy();
    expect(bulkCompleteButton.getAttribute('aria-describedby')).toBe(
      'tasks-bulk-complete-scope-description',
    );

    fireEvent.click(bulkCompleteButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('タスクの一括完了に失敗しました');
    });
    expect(screen.getByText('選択中 2件')).toBeTruthy();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it('excludes handoff confirmation tasks from bulk inline completion', async () => {
    useMutationMock.mockImplementation(
      (options: {
        mutationFn: (payload: unknown) => Promise<unknown>;
        onSuccess?: (result: unknown) => void;
        onError?: (error: unknown) => void;
      }) => ({
        mutate: (payload: unknown) => {
          void options
            .mutationFn(payload)
            .then((result) => options.onSuccess?.(result))
            .catch((error: unknown) => options.onError?.(error));
        },
        isPending: false,
      }),
    );
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      return {
        data: {
          data: [
            {
              id: 'task_handoff',
              task_type: 'handoff_confirmation',
              title: '申し送り確認',
              description: null,
              status: 'pending',
              priority: 'high',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              can_complete_inline: false,
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'visit_record',
              related_entity_id: 'visit_record_1',
              completed_at: null,
              created_at: '2026-04-10T08:00:00.000Z',
            },
            {
              id: 'task_followup',
              task_type: 'follow_up_call',
              title: 'フォロー電話',
              description: null,
              status: 'pending',
              priority: 'normal',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              can_complete_inline: true,
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'patient',
              related_entity_id: 'patient_1',
              completed_at: null,
              created_at: '2026-04-10T08:10:00.000Z',
            },
          ],
        },
        isLoading: false,
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              total: 1,
              completed: 1,
              failed: 0,
              failures: [],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    render(<TasksContent />);

    fireEvent.click(screen.getByRole('button', { name: 'テスト用に2件選択' }));

    expect(screen.getByText('選択中 2件')).toBeTruthy();
    expect(screen.getByText('完了可能 1件')).toBeTruthy();
    expect(screen.getByText('専用画面 1件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /選択した1件を完了/ }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/tasks/bulk', {
        method: 'POST',
        headers: buildOrgJsonHeaders('org_1'),
        body: JSON.stringify({ ids: ['task_followup'] }),
      });
    });
    expect(toast.success).toHaveBeenCalledWith('1件のタスクを完了しました');
  });

  it('does not expose bulk inline completion when only dedicated workflow tasks are selected', () => {
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      return {
        data: {
          data: [
            {
              id: 'task_handoff',
              task_type: 'handoff_confirmation',
              title: '申し送り確認',
              description: null,
              status: 'pending',
              priority: 'high',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              can_complete_inline: false,
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'visit_record',
              related_entity_id: 'visit_record_1',
              completed_at: null,
              created_at: '2026-04-10T08:00:00.000Z',
            },
            {
              id: 'task_visit_preparation',
              task_type: 'handoff_supervision_review',
              title: '申し送り上長確認',
              description: null,
              status: 'pending',
              priority: 'normal',
              assigned_to: 'user_1',
              assigned_to_name: '山田 薬剤師',
              can_complete_inline: false,
              due_date: null,
              sla_due_at: null,
              related_entity_type: 'visit_record',
              related_entity_id: 'visit_record_1',
              completed_at: null,
              created_at: '2026-04-10T08:10:00.000Z',
            },
          ],
        },
        isLoading: false,
      };
    });
    vi.stubGlobal('fetch', vi.fn());

    render(<TasksContent />);

    fireEvent.click(screen.getByRole('button', { name: 'テスト用に2件選択' }));

    expect(screen.getByText('選択中 2件')).toBeTruthy();
    expect(screen.getByText('完了可能 0件')).toBeTruthy();
    expect(screen.getByText('専用画面 2件')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /選択した\d+件を完了/ })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears selected tasks and refreshes task caches after successful bulk completion', async () => {
    const invalidateQueriesMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
    useMutationMock.mockImplementation(
      (options: {
        mutationFn: (payload: unknown) => Promise<unknown>;
        onSuccess?: (result: unknown) => void;
        onError?: (error: unknown) => void;
      }) => ({
        mutate: (payload: unknown) => {
          void options
            .mutationFn(payload)
            .then((result) => options.onSuccess?.(result))
            .catch((error: unknown) => options.onError?.(error));
        },
        isPending: false,
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              total: 2,
              completed: 2,
              failed: 0,
              failures: [],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    render(<TasksContent />);

    fireEvent.click(screen.getByRole('button', { name: 'テスト用に2件選択' }));
    expect(screen.getByText('選択中 2件')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /選択した2件を完了/ }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('2件のタスクを完了しました');
    });
    expect(screen.queryByText('選択中 2件')).toBeNull();
    expect(screen.queryByRole('button', { name: /選択した2件を完了/ })).toBeNull();
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['tasks', 'org_1'] });
  });

  it('paginates the task table at 50 rows/page (W2-F2) so a 51-row result set needs a 2nd page', () => {
    const manyTasks = Array.from({ length: 51 }, (_, index) => ({
      id: `task_${index + 1}`,
      task_type: 'visit_preparation',
      title: `タスク${index + 1}`,
      description: null,
      status: 'pending',
      priority: 'normal',
      assigned_to: 'user_1',
      assigned_to_name: '山田 薬剤師',
      due_date: null,
      sla_due_at: null,
      related_entity_type: 'visit_schedule',
      related_entity_id: 'schedule_1',
      completed_at: null,
      created_at: '2026-04-10T08:00:00.000Z',
    }));
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'tasks-health-board') {
        return taskHealthBoardQueryResult();
      }
      if (options.queryKey?.[0] === 'staff-workload') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      return { data: { data: manyTasks }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<TasksContent />);

    expect(screen.getByText('1/2ページ')).toBeTruthy();
    expect(screen.getByTestId('tasks-table').textContent).toContain('タスク50');
    expect(screen.getByTestId('tasks-table').textContent).not.toContain('タスク51');

    fireEvent.click(screen.getByRole('button', { name: '次のページ' }));

    expect(screen.getByText('2/2ページ')).toBeTruthy();
    expect(screen.getByTestId('tasks-table').textContent).toContain('タスク51');
  });
});
