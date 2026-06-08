// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
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

vi.mock('./weekly-cell-inspector', () => ({
  WeeklyCellInspector: () => <div>weekly-cell-inspector</div>,
}));

setupDomTestEnv();

import { ScheduleWeeklyOptimizer } from './schedule-weekly-optimizer';

describe('ScheduleWeeklyOptimizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/schedules/proposals');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('workspace=optimizer'));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer') {
        return { data: { data: [] }, isLoading: false };
      }
      if (queryKey[0] === 'cases' && queryKey[1] === 'weekly-optimizer-search') {
        return {
          data: {
            data: [
              {
                id: 'case_1',
                status: 'active',
                primary_pharmacist_id: 'pharmacist_1',
                primary_pharmacist_name: '薬剤師A',
                patient: { id: 'patient_1', name: '山田花子', residences: [] },
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });
    useRealtimeQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      connected: true,
    });
  });

  it('lets users search and pin a case, then syncs it to the URL', () => {
    render(<ScheduleWeeklyOptimizer />);

    fireEvent.change(screen.getByLabelText('提案対象ケース'), {
      target: { value: '山田' },
    });
    fireEvent.click(screen.getByRole('button', { name: /山田花子/ }));

    expect(useRouterMock().replace).toHaveBeenCalledWith(
      expect.stringContaining('optimizer_case_id=case_1'),
      { scroll: false },
    );
  });

  it('shows the vehicle resource selector in planner settings', () => {
    render(<ScheduleWeeklyOptimizer />);

    expect(screen.getByLabelText('社用車')).toBeTruthy();
    expect(screen.getByText('未指定なら自動割当')).toBeTruthy();
  });
});
