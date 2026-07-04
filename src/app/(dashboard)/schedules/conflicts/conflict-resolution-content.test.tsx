// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

setupDomTestEnv();

import { ConflictResolutionContent } from './conflict-resolution-content';
import { toast } from 'sonner';

type MutationConfig = {
  mutationFn: (variables: unknown) => Promise<unknown>;
  onSuccess?: (data: unknown, variables: unknown) => Promise<unknown> | unknown;
  onError?: (error: unknown, variables: unknown) => void;
};

function installExecutableMutationMock() {
  useMutationMock.mockImplementation((config: MutationConfig) => ({
    mutate: vi.fn((variables: unknown) => {
      void (async () => {
        try {
          const data = await config.mutationFn(variables);
          await config.onSuccess?.(data, variables);
        } catch (error) {
          config.onError?.(error as Error, variables);
        }
      })();
    }),
    isPending: false,
    variables: undefined,
  }));
}

// 同一薬剤師(ph_1)の時間帯重複 → pharmacist_overlap で plan_a(推奨)が生成される。
function buildConflictingSchedule(over: Record<string, unknown>) {
  return {
    id: 'sch_1',
    case_id: 'case_1',
    pharmacist_id: 'ph_1',
    schedule_status: 'planned',
    scheduled_date: '2026-04-09T00:00:00.000Z',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    priority: 'normal',
    visit_type: 'regular',
    route_order: 1,
    updated_at: '2026-04-09T08:30:00.000Z',
    confirmed_at: null,
    vehicle_resource: null,
    case_: { patient: { id: 'patient_1', name: '患者A' } },
    ...over,
  };
}

const conflictingSchedules = [
  buildConflictingSchedule({ id: 'sch_1', case_: { patient: { name: '患者A' } } }),
  buildConflictingSchedule({
    id: 'sch_2',
    route_order: 2,
    time_window_start: '2026-04-09T09:30:00.000Z',
    time_window_end: '2026-04-09T10:30:00.000Z',
    case_: { patient: { id: 'patient_2', name: '患者B' } },
  }),
];

describe('ConflictResolutionContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    installExecutableMutationMock();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
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
          data: {
            data: [
              { id: 'ph_1', name: '薬剤師A' },
              { id: 'ph_2', name: '薬剤師B' },
            ],
          },
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
    return waitFor(() => {
      expect(screen.getByRole('button', { name: '採用済み' })).toBeTruthy();
    }).then(() => {
      // 対象日を変更すると採用状態がクリアされ、別日で「採用済み」が残らない。
      fireEvent.change(screen.getByLabelText('重なりを確認する対象日'), {
        target: { value: '2026-04-16' },
      });

      expect(screen.queryByRole('button', { name: '採用済み' })).toBeNull();
      expect(screen.getByRole('button', { name: '案Aを採用する' })).toBeTruthy();
    });
  });

  it('surfaces pharmacist lookup failures instead of a false no-conflict state', () => {
    const refetchPharmacistsMock = vi.fn();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'visit-schedules') {
        return {
          data: [],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      if (queryKey[0] === 'pharmacists') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          refetch: refetchPharmacistsMock,
        };
      }
      return { data: undefined, isLoading: false };
    });

    render(<ConflictResolutionContent initialDate="2026-04-09" />);

    expect(screen.getByText('薬剤師一覧を取得できませんでした')).toBeTruthy();
    expect(screen.queryByText('2026-04-09 の予定に重なりはありません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(refetchPharmacistsMock).toHaveBeenCalledTimes(1);
  });

  it('persists Plan A adoption through the visit schedule reorder API', async () => {
    render(<ConflictResolutionContent initialDate="2026-04-09" />);

    fireEvent.click(screen.getByRole('button', { name: '案Aを採用する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/visit-schedules/reorder', expect.any(Object));
    });
    const [, init] = fetchMock.mock.calls.find(
      ([input]) => input === '/api/visit-schedules/reorder',
    )!;
    expect(init).toMatchObject({
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      updates: [
        {
          schedule_id: 'sch_1',
          scheduled_date: '2026-04-09',
          pharmacist_id: 'ph_2',
          route_order: 1,
          expected_route_order: 1,
        },
      ],
      confirmation_context: {
        source: 'schedule_conflict_resolution',
        date: '2026-04-09',
        pharmacist_id: 'ph_2',
        target_count: 1,
        route_order_diff_count: 1,
      },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '採用済み' })).toBeTruthy();
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['visit-schedules', 'conflicts', 'org_1'],
    });
    expect(toast.success).toHaveBeenCalledWith('担当を薬剤師Bへ変更しました');
  });

  it('does not show adopted state when Plan A persistence fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: 'route_order の反映対象が同時に更新されました。再読み込みしてください',
        }),
        {
          status: 409,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    render(<ConflictResolutionContent initialDate="2026-04-09" />);

    fireEvent.click(screen.getByRole('button', { name: '案Aを採用する' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'route_order の反映対象が同時に更新されました。再読み込みしてください',
      );
    });
    expect(screen.queryByRole('button', { name: '採用済み' })).toBeNull();
  });

  it('falls back to the visit route update message when Plan A fails without an Error', () => {
    render(<ConflictResolutionContent initialDate="2026-04-09" />);

    const applyPlanConfig = useMutationMock.mock.calls[0]?.[0] as MutationConfig;
    applyPlanConfig.onError?.({}, {});

    expect(toast.error).toHaveBeenCalledWith('訪問予定の順路更新に失敗しました');
  });

  it('creates a reconfirmation task through the validated schedule endpoint', async () => {
    render(<ConflictResolutionContent initialDate="2026-04-09" />);

    fireEvent.click(screen.getByRole('button', { name: '患者さんへ再確認を依頼' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedules/sch_1/conflict-reconfirmation',
        expect.any(Object),
      );
    });
    const [, init] = fetchMock.mock.calls.find(
      ([input]) => input === '/api/visit-schedules/sch_1/conflict-reconfirmation',
    )!;
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      target_date: '2026-04-09',
      plan_id: 'plan_a',
      expected_schedule_updated_at: '2026-04-09T08:30:00.000Z',
    });
    expect(String(init.body)).not.toContain('患者A');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '再確認依頼済み' })).toBeTruthy();
    });
    expect(toast.success).toHaveBeenCalledWith('患者再確認依頼を作成しました');
  });

  it('falls back to the reconfirmation task message when task creation fails without an Error', () => {
    render(<ConflictResolutionContent initialDate="2026-04-09" />);

    const reconfirmationConfig = useMutationMock.mock.calls[1]?.[0] as MutationConfig;
    reconfirmationConfig.onError?.({}, {});

    expect(toast.error).toHaveBeenCalledWith('患者再確認依頼の作成に失敗しました');
  });
});
