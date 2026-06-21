// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@/components/features/admin/admin-page-header', () => ({
  AdminPageHeader: () => <header data-testid="admin-page-header" />,
}));

vi.mock('@/components/features/admin/admin-page-shortcut-presets', () => ({
  getAdminPerformanceShortcutLinks: () => [],
}));

vi.mock('@/app/(dashboard)/admin/staff/staff-kpi-panel', () => ({
  StaffKpiPanel: () => <section data-testid="staff-kpi-panel" />,
}));

import PerformancePage from './page';

setupDomTestEnv();

describe('PerformancePage polling policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
  });

  it('uses realtime invalidation for workflow metrics and slows runtime polling', () => {
    render(<PerformancePage />);

    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-performance-workflow', 'org_1'],
        invalidateOn: ['workflow_refresh', 'cycle_transition'],
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['admin-performance-schedules', 'org_1']),
        invalidateOn: ['workflow_refresh'],
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['admin-performance-proposals', 'org_1']),
        invalidateOn: ['workflow_refresh'],
        fallbackRefetchInterval: 60_000,
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-performance-runtime', 'org_1'],
        refetchInterval: 60_000,
      }),
    );
  });

  it('shows ErrorState (not a false-empty) with retry when the proposals query fails', () => {
    const refetch = vi.fn();
    useRealtimeQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'admin-performance-proposals') {
        // 訪問候補の取得が失敗 → 空状態ではなく ErrorState + 再読み込み。
        return { data: undefined, isLoading: false, isError: true, refetch };
      }
      return { data: undefined, isLoading: false, refetch };
    });
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });

    render(<PerformancePage />);

    // proposals 失敗は業務 KPI 集計と訪問候補カードの両方を ErrorState 化する。
    expect(screen.getAllByText('サーバーエラーが発生しました').length).toBeGreaterThanOrEqual(1);
    // false-empty（「対象期間の訪問候補はありません」）を出していないこと。
    expect(screen.queryByText('対象期間の訪問候補はありません')).toBeNull();

    const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    expect(refetch).toHaveBeenCalled();
  });

  it('shows ErrorState (not a false-empty) with retry when the runtime metrics query fails', () => {
    const refetch = vi.fn();
    useRealtimeQueryMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });
    // ランタイム指標の取得が失敗 → Slow endpoints と latency snapshot を ErrorState 化。
    useQueryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    render(<PerformancePage />);

    expect(screen.getAllByText('サーバーエラーが発生しました').length).toBeGreaterThanOrEqual(1);
    // false-empty（「サンプル未蓄積」系メッセージ）を出していないこと。
    expect(screen.queryByText('表示できる API latency sample はまだありません')).toBeNull();
    expect(screen.queryByText(/まだ API サンプルがありません/)).toBeNull();
    // 回帰: latency snapshot のサマリ数値(false-zero/未計測)を ErrorState の前に残さないこと。
    expect(screen.queryByText('収集開始')).toBeNull();
    expect(screen.queryByText('サンプル総数')).toBeNull();
    expect(screen.queryByText('記録 route 数')).toBeNull();
    expect(screen.queryByText('5xx 件数')).toBeNull();

    const retryButtons = screen.getAllByRole('button', { name: '再読み込み' });
    fireEvent.click(retryButtons[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
