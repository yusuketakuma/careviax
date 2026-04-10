// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useAuthStoreMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: useAuthStoreMock,
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

import { HandoffBoard } from './handoff-board';

setupDomTestEnv();

describe('HandoffBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/handoff');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    useAuthStoreMock.mockImplementation((selector: (state: {
      currentUser: { id: string };
    }) => unknown) => selector({ currentUser: { id: 'user_1' } }));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          id: 'board_1',
          shift_date: '2026-04-02',
          items: [
            {
              id: 'item_1',
              content: '患者確認が必要',
              priority: 'high',
              entity_type: 'patient',
              entity_id: 'patient_1',
              read_by: [],
              created_by: 'user_2',
              created_by_name: '薬剤師A',
              created_at: '2026-04-02T09:00:00.000Z',
            },
          ],
        },
      },
      isLoading: false,
    });
  });

  it('renders a workflow link when an item has a supported related entity', () => {
    render(<HandoffBoard />);

    expect(screen.getByRole('link', { name: /患者を開く/ }).getAttribute('href')).toEqual(
      '/patients/patient_1'
    );
  });

  it('shows the home context banner and unread filter state', () => {
    render(<HandoffBoard initialFilter="unread" initialContext="dashboard_home" />);

    expect(screen.getByTestId('handoff-context-banner')).toBeTruthy();
    expect(screen.getByText('ホームから未読の申し送りにフォーカスして開いています。')).toBeTruthy();
    expect(screen.getByText('未読のみ')).toBeTruthy();
  });

  it('syncs handoff filter changes back into the URL', async () => {
    render(<HandoffBoard initialContext="dashboard_home" />);

    fireEvent.click(screen.getByRole('button', { name: '未読のみ' }));

    expect(useRouterMock().replace).toHaveBeenCalledWith(
      '/handoff?context=dashboard_home&filter=unread',
      { scroll: false },
    );
  });
});
