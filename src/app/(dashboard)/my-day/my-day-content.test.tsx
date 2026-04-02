// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useAuthStoreMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

import { MyDayContent } from './my-day-content';

setupDomTestEnv();

describe('MyDayContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useAuthStoreMock.mockImplementation((selector: (state: {
      currentUser: { id: string };
    }) => unknown) => selector({ currentUser: { id: 'user_1' } }));
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      switch (queryKey[0]) {
        case 'my-day-visits':
          return {
            data: { data: [] },
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
});
