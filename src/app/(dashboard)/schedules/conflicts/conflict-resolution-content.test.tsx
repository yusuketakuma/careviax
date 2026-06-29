// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));
vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }));
vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

setupDomTestEnv();

import { ConflictResolutionContent } from './conflict-resolution-content';

// 同一薬剤師(ph_1)の時間帯重複 → pharmacist_overlap で plan_a(推奨)が生成される。
function buildConflictingSchedule(over: Record<string, unknown>) {
  return {
    id: 'sch_1',
    pharmacist_id: 'ph_1',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    priority: 'normal',
    visit_type: 'regular',
    confirmed_at: null,
    vehicle_resource: null,
    case_: { patient: { name: '患者A' } },
    ...over,
  };
}

const conflictingSchedules = [
  buildConflictingSchedule({ id: 'sch_1', case_: { patient: { name: '患者A' } } }),
  buildConflictingSchedule({
    id: 'sch_2',
    time_window_start: '2026-04-09T09:30:00.000Z',
    time_window_end: '2026-04-09T10:30:00.000Z',
    case_: { patient: { name: '患者B' } },
  }),
];

describe('ConflictResolutionContent date navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/schedules/conflicts');
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: conflictingSchedules,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      if (queryKey[0] === 'pharmacists') {
        return {
          data: { data: [{ id: 'ph_1', name: '薬剤師A' }] },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });
  });

  it('clears the adopted plan when the target date changes (teeth: stable plan ids must not carry over)', () => {
    render(<ConflictResolutionContent initialDate="2026-04-09" />);

    // 案Aを採用 → 採用済み(disabled)
    const adoptButton = screen.getByRole('button', { name: '案Aを採用する' });
    fireEvent.click(adoptButton);
    expect(screen.getByRole('button', { name: '採用済み' })).toBeTruthy();

    // 対象日を変更すると採用状態がクリアされ、別日で「採用済み」が残らない。
    fireEvent.change(screen.getByLabelText('重なりを確認する対象日'), {
      target: { value: '2026-04-16' },
    });

    expect(screen.queryByRole('button', { name: '採用済み' })).toBeNull();
    expect(screen.getByRole('button', { name: '案Aを採用する' })).toBeTruthy();
  });
});
