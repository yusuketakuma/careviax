// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

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

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data }: { data: Array<{ title: string }> }) => (
    <div data-testid="tasks-table">{data.map((item) => item.title).join(',')}</div>
  ),
}));

import { TasksContent } from './tasks-content';

setupDomTestEnv();

describe('TasksContent', () => {
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
    expect(screen.getByTestId('tasks-table').textContent).toContain('訪問準備');
  });
});
