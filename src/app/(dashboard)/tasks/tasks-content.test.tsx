// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { toast } from 'sonner';
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

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    data,
    onSelectionChange,
  }: {
    data: Array<{ title: string }>;
    onSelectionChange?: (rows: Array<{ title: string }>) => void;
  }) => (
    <div>
      {onSelectionChange ? (
        <button type="button" onClick={() => onSelectionChange(data.slice(0, 2))}>
          テスト用に2件選択
        </button>
      ) : null}
      <div data-testid="tasks-table">{data.map((item) => item.title).join(',')}</div>
    </div>
  ),
}));

import { TasksContent } from './tasks-content';

setupDomTestEnv();

type BulkCompleteMutationOptions = {
  mutationFn: (ids: string[]) => Promise<BulkCompleteTasksResponse['data']>;
  onSuccess: (result: BulkCompleteTasksResponse['data']) => void;
};

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
      (selector: (state: { currentUser: { id: string } }) => unknown) =>
        selector({ currentUser: { id: 'user_1' } }),
    );
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'staff-workload') {
        return {
          data: {
            data: [
              {
                id: 'user_2',
                name: '佐藤 薬剤師',
                role_label: '薬剤師',
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

  it('shows ErrorState (not a false-empty list) with retry when the tasks query fails', () => {
    const refetch = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'staff-workload') {
        return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
      }
      // タスク取得失敗 → 空一覧(false-empty)・偽の0件ではなく ErrorState + 再読み込み。
      return { data: undefined, isLoading: false, isError: true, refetch };
    });

    render(<TasksContent />);

    expect(screen.getByText('サーバーエラーが発生しました')).toBeTruthy();
    expect(screen.queryByTestId('tasks-table')).toBeNull();
    expect(screen.queryByText('該当するタスクはありません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows a retry instead of a false-empty staff workload board when that query fails', () => {
    const refetchStaffWorkload = vi.fn();
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      if (options.queryKey?.[0] === 'staff-workload') {
        // スタッフ別業務量の取得失敗 → 「依頼可能なスタッフがいない」かのような false-empty を出さない。
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: refetchStaffWorkload,
        };
      }
      return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
    });

    render(<TasksContent />);

    expect(screen.getByText('スタッフ別業務量を取得できませんでした。')).toBeTruthy();
    expect(screen.queryByText('依頼可能なスタッフが見つかりません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchStaffWorkload).toHaveBeenCalledTimes(1);
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

    expect(screen.getByText('監査をしてほしい')).toBeTruthy();
    expect(screen.getAllByText('通常').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue('田中さんの監査をしてほしい')).toBeTruthy();
    expect(screen.getByDisplayValue('14:00訪問前に完了')).toBeTruthy();
    expect(screen.getByText('対象の監査タスクに紐づけて依頼します。')).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: /選択した2件を完了/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('タスクの一括完了に失敗しました');
    });
    expect(screen.getByText('選択中 2件')).toBeTruthy();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
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
});
