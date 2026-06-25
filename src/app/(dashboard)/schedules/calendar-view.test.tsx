// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// useMonthSchedules は useRealtimeQuery 経由。これをモックして取得状態(error/empty)を制御する。
const { realtimeQueryMock, refetchMock, orgIdMock } = vi.hoisted(() => ({
  realtimeQueryMock: vi.fn(),
  refetchMock: vi.fn(),
  orgIdMock: vi.fn(() => 'org_1'),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: orgIdMock }));
vi.mock('@/lib/hooks/use-realtime-query', () => ({ useRealtimeQuery: realtimeQueryMock }));

import { CalendarView } from './calendar-view';

function renderCalendar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalendarView />
    </QueryClientProvider>,
  );
}

// カレンダーの日セルは aria-label="M月d日(件数)" を持つ。月ナビ(前月/翌月/今月)は「日」を含まない。
const DAY_CELL_NAME = /月.+日/;

describe('CalendarView false-empty', () => {
  beforeEach(() => {
    realtimeQueryMock.mockReset();
    refetchMock.mockReset();
    orgIdMock.mockReturnValue('org_1');
  });

  it('renders a retryable ErrorState — not an empty calendar — when the schedule fetch fails', () => {
    realtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    expect(screen.getByText('スケジュールを取得できませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    // teeth: 取得失敗が「予定ゼロの空カレンダー」に化けない（日セルを描画しない）。
    expect(screen.queryAllByRole('button', { name: DAY_CELL_NAME })).toHaveLength(0);
  });

  it('renders the calendar grid (not an error) on a successful but empty month', () => {
    realtimeQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    // 取得成功・0件は ErrorState を出さず、通常の空カレンダー(日セル)を描画する。
    expect(screen.queryByText('スケジュールを取得できませんでした')).toBeNull();
    expect(screen.getAllByRole('button', { name: DAY_CELL_NAME }).length).toBeGreaterThan(0);
  });

  it('does not render an error or grid while loading', () => {
    realtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    expect(screen.getByText('読み込み中...')).toBeTruthy();
    expect(screen.queryByText('スケジュールを取得できませんでした')).toBeNull();
    expect(screen.queryAllByRole('button', { name: DAY_CELL_NAME })).toHaveLength(0);
  });

  it('keeps showing loading (not an error) while the org is still bootstrapping', () => {
    // orgId 未確定(bootstrap 中)は isError=true でも error にせず loading 扱い。
    orgIdMock.mockReturnValue('');
    realtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    expect(screen.getByText('読み込み中...')).toBeTruthy();
    expect(screen.queryByText('スケジュールを取得できませんでした')).toBeNull();
  });

  it('refetches when the reload button is clicked', () => {
    realtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
      connected: true,
    });

    renderCalendar();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
