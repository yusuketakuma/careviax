// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

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
      month: '2026-06',
      summary: {
        total_staff: 3,
        avg_monthly_visits: 10,
        avg_report_submission_rate: 90,
        overloaded_count: 1,
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
});
