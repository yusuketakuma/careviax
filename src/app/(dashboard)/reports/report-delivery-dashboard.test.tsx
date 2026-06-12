// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
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
          monthly_trend: [],
          physician_breakdown: [],
          channel_breakdown: [],
          overdue_waiting: [],
        },
      },
      isLoading: false,
    });

    render(<ReportDeliveryDashboard />);

    expect(screen.getByRole('heading', { name: '送達分析・未確認フォロー' })).toBeTruthy();
    expect(screen.getByText('一覧で対象報告を確認したあとに、送達傾向や返信待ちの滞留をまとめて見返すセクションです。')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '送達分析ページを開く' })).toBeNull();
  });
});
