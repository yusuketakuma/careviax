// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const fetchMock = vi.hoisted(() => vi.fn());
const fetchNextPageMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const resetSelectionMock = vi.hoisted(() => vi.fn());
const useInfiniteQueryMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRealtimeEventsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

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

vi.mock('../dispensing/dispense-work-queue.shared', () => ({
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
  }: {
    items: Array<{ id: string }>;
    isLoading: boolean;
  }) => (
    <div data-testid="prescriptions-table" data-loading={String(isLoading)}>
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
    useInfiniteQueryMock.mockReturnValue({
      data: {
        pages: [
          {
            data: [buildRow()],
            hasMore: true,
            nextCursor: 'intake_1',
            totalCount: 75,
          },
        ],
      },
      isLoading: false,
      fetchNextPage: fetchNextPageMock,
      hasNextPage: true,
      isFetchingNextPage: false,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
        hasMore: true,
        nextCursor: 'cursor_1',
        totalCount: 75,
      }),
    });
  });

  it('fetches one server page with limit/cursor and no polling interval', async () => {
    render(<PrescriptionsWorkspace />);

    const options = latestInfiniteQueryOptions();
    expect(options.queryKey).toEqual(['prescription-intakes', 'org_1', 'all', 'all']);
    expect(options.refetchInterval).toBeUndefined();
    expect(options.getNextPageParam({ nextCursor: 'cursor_1' })).toBe('cursor_1');

    await options.queryFn({ pageParam: undefined });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    let url = parseFetchUrl();
    expect(url.pathname).toBe('/api/prescription-intakes');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('include_total')).toBe('1');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(url.searchParams.has('status')).toBe(false);
    expect(url.searchParams.has('source_type')).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { 'x-org-id': 'org_1' },
    });

    fetchMock.mockClear();
    await options.queryFn({ pageParam: 'cursor_1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    url = parseFetchUrl();
    expect(url.searchParams.get('cursor')).toBe('cursor_1');
  });

  it('passes status and source filters as API query params', async () => {
    render(<PrescriptionsWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: '疑義' }));
    fireEvent.click(screen.getByRole('button', { name: 'FAX' }));

    const options = latestInfiniteQueryOptions();
    expect(options.queryKey).toEqual(['prescription-intakes', 'org_1', 'inquiry_pending', 'fax']);

    await options.queryFn({ pageParam: undefined });

    const url = parseFetchUrl();
    expect(url.searchParams.get('status')).toBe('inquiry_pending');
    expect(url.searchParams.get('source_type')).toBe('fax');
    expect(resetSelectionMock).toHaveBeenCalledTimes(2);
  });

  it('loads the next page from the explicit load-more control', () => {
    render(<PrescriptionsWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }));

    expect(fetchNextPageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps realtime invalidation without interval polling', () => {
    render(<PrescriptionsWorkspace />);

    const realtimeOptions = latestRealtimeOptions();
    expect(realtimeOptions.enabled).toBe(true);

    realtimeOptions.onEvent({ type: 'workflow_refresh' });
    expect(invalidateQueriesMock).not.toHaveBeenCalled();

    realtimeOptions.onEvent({ type: 'prescription_intake_created' });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['prescription-intakes', 'org_1'],
    });
  });
});
