// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useAuthStoreMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
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

describe('MyDayContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/my-day');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    useAuthStoreMock.mockImplementation((selector: (state: {
      currentUser: { id: string };
    }) => unknown) => selector({ currentUser: { id: 'user_1' } }));
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
            data: {
              actions: [],
              pipeline: [],
            },
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
    expect(taskLink.getAttribute('href')).toEqual('/visits/handoffs/visit_record_1');
    expect(screen.getByText('申し送り / 申し送りを確認')).toBeTruthy();
  });

  it('shows quick links to task and workflow workbenches', () => {
    render(<MyDayContent />);

    expect(screen.getByRole('link', { name: 'ダッシュボード' }).getAttribute('href')).toEqual(
      '/dashboard'
    );
    expect(screen.getByRole('link', { name: 'タスク' }).getAttribute('href')).toEqual('/tasks');
    expect(screen.getByRole('link', { name: 'ワークフロー' }).getAttribute('href')).toEqual('/workflow');
    expect(screen.getByRole('link', { name: '申し送り' }).getAttribute('href')).toEqual('/handoff');
    expect(screen.getByRole('link', { name: '通知' }).getAttribute('href')).toEqual(
      '/notifications'
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
    expect(screen.getByText('山田花子')).toBeTruthy();
    expect(screen.queryByText('佐藤次郎')).toBeNull();
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
