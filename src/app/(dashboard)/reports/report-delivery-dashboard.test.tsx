// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ReportDeliveryDashboard } from './report-delivery-dashboard';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ReportDeliveryDashboard', () => {
  it('keeps analytics as a secondary section instead of a primary page-level link', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          summary: {
            current_month: '2026-04',
            current_month_attempted_count: 3,
            current_month_success_rate: 67,
            current_month_failed_count: 1,
            current_month_confirmed_rate: 33,
            overdue_waiting_count: 1,
            overdue_threshold_days: 7,
          },
          monthly_trend: [
            {
              month: '2026-04',
              attempted_count: 3,
              success_count: 2,
              failed_count: 1,
              confirmed_count: 1,
              response_waiting_count: 1,
              success_rate: 67,
              confirmed_rate: 33,
            },
          ],
          physician_breakdown: [
            {
              recipient_name: '田中医師',
              total_count: 3,
              success_count: 2,
              confirmed_count: 1,
              success_rate: 67,
            },
          ],
          channel_breakdown: [
            {
              channel: 'fax',
              total_count: 3,
              success_count: 2,
              failed_count: 1,
              success_rate: 67,
            },
          ],
          overdue_waiting: [
            {
              id: 'delivery_1',
              report_id: 'report_1',
              patient_id: 'patient_1',
              patient_name: '患者A',
              report_type: 'visit_report',
              recipient_name: '田中医師',
              recipient_contact: '03-0000-0000',
              channel: 'fax',
              sent_at: '2026-04-08T10:00:00.000Z',
              days_waiting: 8,
            },
          ],
        },
      },
      isLoading: false,
    });

    render(<ReportDeliveryDashboard />);

    expect(screen.getByRole('heading', { name: '送達分析・未確認フォロー' })).toBeTruthy();
    expect(
      screen.getByText(
        '一覧で対象報告を確認したあとに、送達傾向や返信待ちの滞留をまとめて見返すセクションです。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getByText('2026-04')).toBeTruthy();
    expect(screen.getByText('田中医師')).toBeTruthy();
    expect(screen.getByText('患者A')).toBeTruthy();
    expect(screen.getByText('8日経過')).toBeTruthy();
    expect(screen.getByLabelText('未確認報告の超過日数')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'リマインドタスク起票' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '送達分析ページを開く' })).toBeNull();
  });

  it('shows an error state instead of empty analytics when delivery analytics fail to load', () => {
    const refetch = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<ReportDeliveryDashboard />);

    expect(screen.getByRole('heading', { name: '送達分析を表示できません' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    expect(screen.queryByText('送達データがありません')).toBeNull();
    expect(screen.queryByText('7日超の未確認報告はありません。')).toBeNull();
    expect(screen.queryByRole('button', { name: 'リマインドタスク起票' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
