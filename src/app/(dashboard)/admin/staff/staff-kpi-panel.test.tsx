// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildAdminStaffMetricsApiPath } from '@/lib/staff-metrics/api-paths';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

vi.mock('@/lib/staff-metrics/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/staff-metrics/api-paths')>();
  return {
    ...actual,
    buildAdminStaffMetricsApiPath: vi.fn(actual.buildAdminStaffMetricsApiPath),
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data }: { data: unknown[] }) => (
    <div data-testid="staff-kpi-table" data-rows={data.length} />
  ),
}));

import { StaffKpiPanel } from './staff-kpi-panel';

setupDomTestEnv();

const SUCCESS_DATA = {
  data: {
    data: {
      month: CURRENT_MONTH,
      summary: {
        total_staff: 1,
        avg_monthly_visits: 10,
        avg_report_submission_rate: 90,
        overloaded_count: 0,
        underutilized_count: 0,
      },
      items: [
        {
          id: 's1',
          name: '山田',
          name_kana: null,
          email: 'a@b.c',
          role: 'pharmacist',
          site_name: '本店',
          monthly_visit_count: 10,
          assigned_patient_count: 5,
          avg_visit_minutes: 30,
          report_submission_rate: 90,
          shift_days: 20,
          shift_hours: 160,
          workload_balance_delta_percent: 5,
          workload_utilization_percent: 80,
          max_weekly_visits: null,
          max_travel_minutes: null,
        },
      ],
    },
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

describe('StaffKpiPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue(SUCCESS_DATA);
  });

  it('renders the month picker and KPI table when the query succeeds', () => {
    render(<StaffKpiPanel />);

    expect(screen.getByLabelText('対象月')).toBeTruthy();
    const table = screen.getByTestId('staff-kpi-table');
    expect(table).toBeTruthy();
    expect(table.getAttribute('data-rows')).toBe('1');
  });

  it('delegates the KPI fetch to shared path and org-header helpers', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(SUCCESS_DATA.data)));
    vi.stubGlobal('fetch', fetchMock);
    let queryPromise: Promise<unknown> | undefined;
    useQueryMock.mockImplementationOnce(({ queryFn }: { queryFn: () => Promise<unknown> }) => {
      queryPromise = queryFn();
      return SUCCESS_DATA;
    });

    render(<StaffKpiPanel />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const parsed = await queryPromise;
    expect(parsed).toMatchObject({
      data: {
        month: CURRENT_MONTH,
        summary: SUCCESS_DATA.data.data.summary,
        items: [
          expect.objectContaining({
            id: 's1',
            name: '山田',
            role: 'pharmacist',
            monthly_visit_count: 10,
            assigned_patient_count: 5,
            report_submission_rate: 90,
          }),
        ],
      },
    });
    const parsedItems = (parsed as { data: { items: Array<Record<string, unknown>> } }).data.items;
    expect(parsedItems[0]).not.toHaveProperty('email');
    expect(parsedItems[0]).not.toHaveProperty('max_weekly_visits');
    expect(buildAdminStaffMetricsApiPath).toHaveBeenCalledWith(expect.any(URLSearchParams));
    expect(buildOrgHeaders).toHaveBeenCalledWith('org_1');
    expect(fetchMock).toHaveBeenCalledWith(`/api/admin/staff-metrics?month=${currentMonth}`, {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('keeps the month picker but shows ErrorState (not false-zeros) with retry on failure', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<StaffKpiPanel />);

    // 月ピッカーは残し、ユーザーが月を変えて再取得できる状態を保つ。
    expect(screen.getByLabelText('対象月')).toBeTruthy();
    expect(screen.getByText('サーバーエラーが発生しました')).toBeTruthy();
    // KPI の false-zero と空テーブルを出していないこと。
    expect(screen.queryByText('0名')).toBeNull();
    expect(screen.queryByTestId('staff-kpi-table')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a successful response for another month before it reaches query state', async () => {
    const wrongMonth = CURRENT_MONTH === '2026-01' ? '2026-02' : '2026-01';
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...SUCCESS_DATA.data,
            data: { ...SUCCESS_DATA.data.data, month: wrongMonth },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: SUCCESS_DATA.data,
      refetch: vi.fn(),
    });

    render(<StaffKpiPanel />);

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as
      | { queryFn: () => Promise<unknown> }
      | undefined;
    await expect(queryOptions?.queryFn()).rejects.toThrow('スタッフKPIの取得に失敗しました');
  });

  it('rejects a successful response when summary counts drift from the staff rows', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...SUCCESS_DATA.data,
            data: {
              ...SUCCESS_DATA.data.data,
              summary: { ...SUCCESS_DATA.data.data.summary, total_staff: 2 },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: SUCCESS_DATA.data,
      refetch: vi.fn(),
    });

    render(<StaffKpiPanel />);

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as
      | { queryFn: () => Promise<unknown> }
      | undefined;
    await expect(queryOptions?.queryFn()).rejects.toThrow('スタッフKPIの取得に失敗しました');
  });

  it('rejects a successful response with duplicate staff identities', async () => {
    const item = SUCCESS_DATA.data.data.items[0];
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...SUCCESS_DATA.data,
            data: {
              ...SUCCESS_DATA.data.data,
              summary: { ...SUCCESS_DATA.data.data.summary, total_staff: 2 },
              items: [item, item],
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: SUCCESS_DATA.data,
      refetch: vi.fn(),
    });

    render(<StaffKpiPanel />);

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as
      | { queryFn: () => Promise<unknown> }
      | undefined;
    await expect(queryOptions?.queryFn()).rejects.toThrow('スタッフKPIの取得に失敗しました');
  });
});
