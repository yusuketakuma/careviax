// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
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

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { NotificationsContent } from './notifications-content';

setupDomTestEnv();

describe('NotificationsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/notifications');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[2] === 'unread') {
        return {
          data: {
            data: [
              {
                id: 'notification_1',
                type: 'urgent',
                title: '緊急通知',
                message: '至急対応が必要です',
                link: '/workflow',
                is_read: false,
                created_at: '2026-04-10T08:00:00.000Z',
              },
            ],
          },
          isLoading: false,
        };
      }

      return {
        data: { data: [] },
        isLoading: false,
      };
    });
  });

  it('shows the home context banner and seeds initial unread urgent filters', () => {
    render(
      <NotificationsContent
        initialTab="unread"
        initialTypeFilter="urgent"
        initialContext="dashboard_home"
      />,
    );

    expect(screen.getByTestId('notifications-context-banner')).toBeTruthy();
    expect(screen.getByText('ホームから未読の緊急通知にフォーカスして開いています。')).toBeTruthy();
    expect(screen.getByText('緊急通知')).toBeTruthy();
  });
});
