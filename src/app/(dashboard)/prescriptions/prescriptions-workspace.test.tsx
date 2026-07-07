// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { buildOrgHeaders } from '@/lib/api/org-headers';

const fetchMock = vi.hoisted(() => vi.fn());
const fetchNextPageMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const refetchMock = vi.hoisted(() => vi.fn());
const resetSelectionMock = vi.hoisted(() => vi.fn());
const useInfiniteQueryMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRealtimeEventsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

// Actual-backed spy so the GET header test can prove helper adoption via return-value identity.
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

vi.mock('@/lib/hooks/use-realtime-events', () => ({
  useRealtimeEvents: useRealtimeEventsMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: useInfiniteQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/components/features/keyboard/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('../dispense/dispense-work-queue.shared', () => ({
  useSelectableQueueState: (items: Array<{ id: string }>) => ({
    selectedItem: items[0] ?? null,
    handleMoveUp: vi.fn(),
    handleMoveDown: vi.fn(),
    handleRowClick: vi.fn(),
    resetSelection: resetSelectionMock,
  }),
}));

vi.mock('./prescriptions-table', () => ({
  PrescriptionsTable: ({
    items,
    isLoading,
    isError,
    errorMessage,
    onRetry,
  }: {
    items: Array<{ id: string }>;
    isLoading: boolean;
    isError?: boolean;
    errorMessage?: string;
    onRetry?: () => void;
  }) => (
    <div
      data-testid="prescriptions-table"
      data-loading={String(isLoading)}
      data-error={String(isError)}
    >
      {errorMessage ? <span>{errorMessage}</span> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          再読み込み
        </button>
      ) : null}
      {items.map((item) => (
        <span key={item.id}>{item.id}</span>
      ))}
    </div>
  ),
}));

vi.mock('./prescription-inline-detail', () => ({
  PrescriptionInlineDetail: ({ intakeId }: { intakeId: string }) => (
    <div data-testid="prescription-detail">{intakeId}</div>
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { PrescriptionsWorkspace } from './prescriptions-workspace';

setupDomTestEnv();

type InfiniteQueryOptions = {
  queryKey: readonly unknown[];
  queryFn: (context: { pageParam?: string }) => Promise<unknown>;
  getNextPageParam: (page: { nextCursor?: string }) => string | undefined;
  refetchInterval?: unknown;
};

function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'intake_1',
    cycle_id: 'cycle_1',
    source_type: 'paper',
    prescribed_date: '2026-04-20T00:00:00.000Z',
    prescriber_name: '佐藤医師',
    prescriber_institution: '佐藤医院',
    prescription_expiry_date: null,
    refill_remaining_count: null,
    refill_next_dispense_date: null,
    created_at: '2026-04-20T09:00:00.000Z',
    cycle: {
      overall_status: 'inquiry_pending',
      patient_id: 'patient_1',
      case_: {
        patient: {
          id: 'patient_1',
          name: '山田太郎',
          name_kana: 'ヤマダタロウ',
        },
      },
    },
    ...overrides,
  };
}

function latestInfiniteQueryOptions() {
  const calls = useInfiniteQueryMock.mock.calls;
  const options = calls.at(-1)?.[0] as InfiniteQueryOptions | undefined;
  if (!options) throw new Error('useInfiniteQuery options are required');
  return options;
}

function latestRealtimeOptions() {
  const calls = useRealtimeEventsMock.mock.calls;
  const options = calls.at(-1)?.[0] as
    | { enabled: boolean; onEvent: (event: unknown) => void }
    | undefined;
  if (!options) throw new Error('useRealtimeEvents options are required');
  return options;
}

function parseFetchUrl() {
  const url = fetchMock.mock.calls.at(-1)?.[0];
  if (typeof url !== 'string') throw new Error('fetch URL is required');
  return new URL(url, 'http://localhost');
}

describe('PrescriptionsWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: invalidateQueriesMock });
    useRealtimeEventsMock.mockReturnValue({ connected: true });
    useInfiniteQueryMock.mockReturnValue({
      data: {
        pages: [
          {
            data: [buildRow()],
            hasMore: true,
            nextCursor: 'intake_1',
            totalCount: 75,
            facets: {
              status: {
                inquiry_pending: 12,
                ready_to_dispense: 34,
              },
              source_type: {
                paper: 40,
                fax: 20,
              },
            },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
      fetchNextPage: fetchNextPageMock,
      hasNextPage: true,
      isFetchingNextPage: false,
    });
    fetchMock.mockImplementation(async () =>
      jsonResponse({
        data: [],
        hasMore: true,
        nextCursor: 'cursor_1',
        totalCount: 75,
        facets: {
          status: {
            inquiry_pending: 12,
            ready_to_dispense: 34,
          },
        },
      }),
    );
  });

  it('fetches one server page with limit/cursor, no polling, and helper org headers', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);

    render(<PrescriptionsWorkspace />);

    const options = latestInfiniteQueryOptions();
    // infinite queryKey carries the status/source filters; realtime invalidation key (['prescription-intakes','org_1']) is separate.
    expect(options.queryKey).toEqual(['prescription-intakes', 'org_1', 'all', 'all', '']);
    expect(options.refetchInterval).toBeUndefined();
    expect(options.getNextPageParam({ nextCursor: 'cursor_1' })).toBe('cursor_1');

    await options.queryFn({ pageParam: undefined });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    let url = parseFetchUrl();
    expect(url.pathname).toBe('/api/prescription-intakes');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('include_total')).toBe('1');
    expect(url.searchParams.get('facets')).toBe('1');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(url.searchParams.has('status')).toBe(false);
    expect(url.searchParams.has('source_type')).toBe(false);
    // helper-return identity (toBe), not an equal-shaped literal; helper called with the real org.
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toBe(
      sentinelHeaders,
    );
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');

    fetchMock.mockClear();
    await options.queryFn({ pageParam: 'cursor_1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    url = parseFetchUrl();
    expect(url.searchParams.get('cursor')).toBe('cursor_1');
  });

  it('shows server facet counts instead of loaded-window status counts', () => {
    render(<PrescriptionsWorkspace />);

    expect(screen.getByText(/疑義 12件/)).toBeTruthy();
    expect(screen.getByText(/調剤待 34件/)).toBeTruthy();
  });

  it('keeps the API message when the prescription intake list fetch fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: '処方受付一覧を表示できません' }, 403));

    render(<PrescriptionsWorkspace />);

    const options = latestInfiniteQueryOptions();
    await expect(options.queryFn({ pageParam: 'cursor_1' })).rejects.toThrow(
      '処方受付一覧を表示できません',
    );

    const url = parseFetchUrl();
    expect(url.pathname).toBe('/api/prescription-intakes');
    expect(url.searchParams.get('cursor')).toBe('cursor_1');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('include_total')).toBe('1');
    expect(url.searchParams.get('facets')).toBe('1');
  });

  it('passes status and source filters as API query params', async () => {
    render(<PrescriptionsWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: '疑義' }));
    fireEvent.click(screen.getByRole('button', { name: 'FAX' }));

    const options = latestInfiniteQueryOptions();
    expect(options.queryKey).toEqual([
      'prescription-intakes',
      'org_1',
      'inquiry_pending',
      'fax',
      '',
    ]);

    await options.queryFn({ pageParam: undefined });

    const url = parseFetchUrl();
    expect(url.searchParams.get('status')).toBe('inquiry_pending');
    expect(url.searchParams.get('source_type')).toBe('fax');
    expect(url.searchParams.get('facets')).toBe('1');
    expect(resetSelectionMock).toHaveBeenCalledTimes(2);
  });

  it('submits prescription search as a server-side q filter', async () => {
    render(<PrescriptionsWorkspace />);

    fireEvent.change(
      screen.getByRole('textbox', {
        name: '患者名・カナ・処方医・医療機関・受付番号で検索',
      }),
      { target: { value: '山田' } },
    );
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    const options = latestInfiniteQueryOptions();
    expect(options.queryKey).toEqual(['prescription-intakes', 'org_1', 'all', 'all', '山田']);

    await options.queryFn({ pageParam: undefined });

    const url = parseFetchUrl();
    expect(url.searchParams.get('q')).toBe('山田');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('include_total')).toBe('1');
    expect(url.searchParams.get('facets')).toBe('1');
    expect(screen.getByText(/検索条件全件/)).toBeTruthy();
    expect(resetSelectionMock).toHaveBeenCalledTimes(1);
  });

  it('clears active prescription search and removes q from the server request', async () => {
    render(<PrescriptionsWorkspace />);

    const searchBox = screen.getByRole('textbox', {
      name: '患者名・カナ・処方医・医療機関・受付番号で検索',
    });
    fireEvent.change(searchBox, { target: { value: '山田' } });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    fireEvent.click(screen.getByRole('button', { name: '検索語をクリア' }));

    const options = latestInfiniteQueryOptions();
    expect(options.queryKey).toEqual(['prescription-intakes', 'org_1', 'all', 'all', '']);

    await options.queryFn({ pageParam: undefined });

    const url = parseFetchUrl();
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.get('facets')).toBe('1');
    expect(screen.queryByText(/検索条件全件/)).toBeNull();
    expect(resetSelectionMock).toHaveBeenCalledTimes(2);
  });

  it('loads the next page from the explicit load-more control', () => {
    render(<PrescriptionsWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));

    expect(fetchNextPageMock).toHaveBeenCalledTimes(1);
  });

  it('uses a prescription-specific label while loading the next page', () => {
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ data: [buildRow()], nextCursor: 'cursor_1', totalCount: 75 }] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: refetchMock,
      fetchNextPage: fetchNextPageMock,
      hasNextPage: true,
      isFetchingNextPage: true,
    });

    render(<PrescriptionsWorkspace />);

    expect(screen.getByRole('button', { name: '処方一覧を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '読み込み中...' })).toBeNull();
  });

  it('keeps source-scoped realtime invalidation without interval polling', () => {
    vi.useFakeTimers();

    try {
      render(<PrescriptionsWorkspace />);

      const realtimeOptions = latestRealtimeOptions();
      expect(realtimeOptions.enabled).toBe(true);

      realtimeOptions.onEvent({ type: 'workflow_refresh' });
      expect(invalidateQueriesMock).not.toHaveBeenCalled();

      realtimeOptions.onEvent({ type: 'workflow_refresh', source: 'dashboard' });
      expect(invalidateQueriesMock).not.toHaveBeenCalled();

      realtimeOptions.onEvent({ type: 'workflow_refresh', source: 'prescription_intakes_create' });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: ['prescription-intakes', 'org_1'],
      });

      invalidateQueriesMock.mockClear();
      realtimeOptions.onEvent({ type: 'cycle_transition' });
      expect(invalidateQueriesMock).not.toHaveBeenCalled();

      realtimeOptions.onEvent({ type: 'cycle_transition', source: 'visit_schedules_update' });
      expect(invalidateQueriesMock).not.toHaveBeenCalled();

      realtimeOptions.onEvent({ type: 'cycle_transition', source: 'medication_cycles_transition' });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: ['prescription-intakes', 'org_1'],
      });

      invalidateQueriesMock.mockClear();

      realtimeOptions.onEvent({ type: 'qr_draft_created' });
      expect(invalidateQueriesMock).not.toHaveBeenCalled();

      realtimeOptions.onEvent({ type: 'qr_draft_confirmed' });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(invalidateQueriesMock).toHaveBeenCalledWith({
        queryKey: ['prescription-intakes', 'org_1'],
      });

      invalidateQueriesMock.mockClear();
      realtimeOptions.onEvent({ type: 'prescription_intake_created' });
      expect(invalidateQueriesMock).not.toHaveBeenCalled();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('disables the intake query and realtime invalidation until org is available', () => {
    useOrgIdMock.mockReturnValue('');

    render(<PrescriptionsWorkspace />);

    expect(latestInfiniteQueryOptions()).toEqual(expect.objectContaining({ enabled: false }));
    expect(latestRealtimeOptions()).toEqual(expect.objectContaining({ enabled: false }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes prescription intake query failures as an error state with retry instead of an empty table', () => {
    useInfiniteQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('処方受付一覧の取得に失敗しました'),
      refetch: refetchMock,
      fetchNextPage: fetchNextPageMock,
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    render(<PrescriptionsWorkspace />);

    const table = screen.getByTestId('prescriptions-table');
    expect(table.getAttribute('data-error')).toBe('true');
    expect(table.textContent).toContain('処方受付一覧の取得に失敗しました');
    expect(table.textContent).not.toContain('該当する処方受付がありません');

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses a mobile-first stacked master-detail layout before widening on large screens', () => {
    render(<PrescriptionsWorkspace />);

    expect(screen.getByTestId('prescriptions-workspace')).toBeTruthy();

    const masterDetailClass = screen.getByTestId('prescriptions-master-detail').className;
    expect(masterDetailClass).toContain('flex-col');
    expect(masterDetailClass).toContain('lg:flex-row');

    const masterPaneClass = screen.getByTestId('prescriptions-master-pane').className;
    expect(masterPaneClass).toContain('w-full');
    expect(masterPaneClass).toContain('h-[45dvh]');
    expect(masterPaneClass).toContain('lg:w-[480px]');
    expect(masterPaneClass).toContain('lg:h-auto');

    expect(screen.getByTestId('prescriptions-detail-pane').className).toContain('min-h-[18rem]');
  });

  it('keeps first-fold prescription actions at the 44px target across breakpoints', () => {
    render(<PrescriptionsWorkspace />);

    for (const name of ['新規受付', 'QR下書き', '調剤キュー']) {
      const links = screen.getAllByRole('link', { name });
      expect(links.length).toBeGreaterThan(0);
      expect(links.every((link) => link.className.includes('min-h-[44px]'))).toBe(true);
      expect(links.some((link) => link.className.includes('sm:!min-h-[44px]'))).toBe(true);
    }
  });
});
