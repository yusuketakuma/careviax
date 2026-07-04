// @vitest-environment jsdom

import type { QueryClient } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { StatisticsContent } from './statistics-content';
import { STATISTICS_CATEGORIES, STATISTICS_SURFACES } from './statistics-surfaces';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: vi.fn(() => 'org_1'),
}));

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

const useOrgIdMock = vi.mocked(useOrgId);

setupDomTestEnv();

const DISPENSING_STATS_URL = '/api/dashboard/dispensing-stats';

// The real /api/dashboard/dispensing-stats returns RAW success fields (success() =
// NextResponse.json(data) — NO { data } envelope). The mock MUST mirror that raw shape,
// otherwise the test passes against a payload the production route never emits.
function dispensingSuccess() {
  return new Response(
    JSON.stringify({
      pendingTasks: 5,
      auditPendingTasks: 2,
      completedToday: 7,
    }),
    { status: 200 },
  );
}

function makeClient() {
  return createTestQueryClient();
}

function renderContent() {
  return render(<StatisticsContent surfaces={STATISTICS_SURFACES} />, {
    wrapper: createQueryClientWrapper(),
  });
}

function renderWithClient(queryClient: QueryClient) {
  return render(<StatisticsContent surfaces={STATISTICS_SURFACES} />, {
    wrapper: createQueryClientWrapper(queryClient),
  });
}

describe('StatisticsContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.mocked(buildOrgHeaders).mockImplementation((orgId, extra) => ({
      'x-org-id': orgId,
      ...extra,
    }));
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('renders every category section and links each surface to its internal route', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => dispensingSuccess()),
    );

    const { container } = renderContent();

    // every category has a heading
    for (const category of STATISTICS_CATEGORIES) {
      expect(screen.getByRole('heading', { name: category })).toBeTruthy();
    }
    // every surface renders a deep link to its internal href, labelled by the surface
    for (const surface of STATISTICS_SURFACES) {
      const link = container.querySelector(`a[href="${surface.href}"]`);
      expect(link, `missing link for ${surface.href}`).toBeTruthy();
      expect(link?.textContent).toContain(surface.label);
    }
  });

  it('fetches ONLY the allowlisted dispensing-stats endpoint on load', async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return dispensingSuccess();
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    // headline KPI resolves
    expect(await screen.findByText('調剤 未着手')).toBeTruthy();

    // the hub must not fetch any non-allowlisted endpoint (no overdue / me-activity / admin/*)
    const urls = requestedUrls;
    expect(urls.every((url) => url === DISPENSING_STATS_URL)).toBe(true);
    expect(urls).toContain(DISPENSING_STATS_URL);
  });

  it('renders the headline KPI numbers on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => dispensingSuccess()),
    );

    renderContent();

    expect(await screen.findByText('調剤 未着手')).toBeTruthy();
    expect(screen.getByText('鑑査待ち')).toBeTruthy();
    expect(screen.getByText('本日完了')).toBeTruthy();
    // the distinct KPI numbers render (pending 5 / audit 2 / today 7)
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('shows a locked state (not false-empty zeros) when the KPI endpoint returns 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    );

    renderContent();

    expect(await screen.findByText('調剤指標は権限により表示できません')).toBeTruthy();
    // categorized sections still render (the hub is not blocked by a locked KPI)
    expect(screen.getByRole('heading', { name: '経営' })).toBeTruthy();
  });

  it('shows an error state when the KPI endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('error', { status: 500 })),
    );

    renderContent();

    expect(await screen.findByText('調剤指標を取得できませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });

  it('fails closed on a malformed 2xx (no KPI numbers, category links still render)', async () => {
    // 200 OK but the raw body is missing required numeric fields -> readApiJson schema fails -> ErrorState.
    // (A wrong { data } envelope would also fail, which is exactly how the rev7 bug went unnoticed.)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ pendingTasks: 5 }), { status: 200 })),
    );

    renderContent();

    expect(await screen.findByText('調剤指標を取得できませんでした')).toBeTruthy();
    // no fabricated KPI numbers, and the categorized directory still works
    expect(screen.queryByText('調剤 未着手')).toBeNull();
    expect(screen.getByRole('heading', { name: '経営' })).toBeTruthy();
    expect(document.querySelector('a[href="/admin/metrics"]')).toBeTruthy();
  });

  it('fails closed on impossible count values (negative / decimal) in a 2xx body', async () => {
    // The route emits Prisma count() values (non-negative integers). A 200 OK carrying a negative or
    // decimal count is impossible/corrupt -> schema (.int().nonnegative()) must reject and render the
    // static ErrorState rather than a fabricated KPI.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              pendingTasks: -5,
              auditPendingTasks: 2.5,
              completedToday: 7,
            }),
            { status: 200 },
          ),
      ),
    );

    renderContent();

    expect(await screen.findByText('調剤指標を取得できませんでした')).toBeTruthy();
    // no KPI strip rendered, but the categorized directory still works
    expect(screen.queryByText('調剤 未着手')).toBeNull();
    expect(screen.getByRole('heading', { name: '経営' })).toBeTruthy();
    expect(document.querySelector('a[href="/admin/metrics"]')).toBeTruthy();
  });

  it('rejects a { data } enveloped 2xx as malformed (the route returns RAW fields, not an envelope)', async () => {
    // Locks the rev7 regression: the client previously wrapped the schema with apiDataSchema and
    // read payload.data, so a REAL raw success was treated as malformed. If anyone reintroduces the
    // envelope, this enveloped body would render KPI numbers — and this test would fail.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                pendingTasks: 5,
                auditPendingTasks: 2,
                completedToday: 7,
              },
            }),
            { status: 200 },
          ),
      ),
    );

    renderContent();

    expect(await screen.findByText('調剤指標を取得できませんでした')).toBeTruthy();
    expect(screen.queryByText('調剤 未着手')).toBeNull();
  });

  it('starts exactly one fetch once the org id hydrates from empty to a real value', async () => {
    useOrgIdMock.mockReturnValue('');
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn(async () => dispensingSuccess());
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = makeClient();
    const wrapper = createQueryClientWrapper(queryClient);
    const { rerender } = render(<StatisticsContent surfaces={STATISTICS_SURFACES} />, {
      wrapper,
    });

    // disabled while hydrating
    expect(fetchMock).not.toHaveBeenCalled();

    // org id resolves -> the query enables and fetches exactly once with the org header
    useOrgIdMock.mockReturnValue('org_1');
    rerender(<StatisticsContent surfaces={STATISTICS_SURFACES} />);

    expect(await screen.findByText('調剤 未着手')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(url).toBe(DISPENSING_STATS_URL);
    expect(init.headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
  });

  it('does not leak raw error-body / PHI-like text into the rendered error', async () => {
    const leaky = JSON.stringify({
      message: '患者 山田花子 (東京都千代田区1-1-1) SELECT * FROM patients WHERE id=42',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(leaky, { status: 500 })),
    );

    const { container } = renderContent();

    expect(await screen.findByText('調剤指標を取得できませんでした')).toBeTruthy();
    // §9/§10: no raw patient-like / SQL-ish substrings reach the UI
    expect(container.textContent).not.toContain('山田花子');
    expect(container.textContent).not.toContain('東京都千代田区');
    expect(container.textContent).not.toContain('SELECT * FROM');
  });

  it('keeps the last KPI values and shows a non-blocking warning when a refetch fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return call === 1 ? dispensingSuccess() : new Response('error', { status: 500 });
      }),
    );

    const queryClient = makeClient();
    renderWithClient(queryClient);

    expect(await screen.findByText('調剤 未着手')).toBeTruthy();
    // first-load values (pending 5 / audit 2 / today 7) are on screen
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['statistics-dispensing-kpi', 'org_1'] });
    });

    // stale KPI VALUES retained (NOT wiped to 0 / swapped) + a non-blocking refetch warning
    expect(screen.getByText('調剤 未着手')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(
      await screen.findByText('最新の調剤指標を取得できませんでした。表示は前回取得した値です。'),
    ).toBeTruthy();
    // and the blocking first-load error must NOT be shown (data is retained, not wiped)
    expect(screen.queryByText('調剤指標を取得できませんでした')).toBeNull();
  });

  it('shows a loading state and does not fetch while the org id is still hydrating', () => {
    useOrgIdMock.mockReturnValue('');
    const fetchMock = vi.fn(async () => dispensingSuccess());
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    // no fetch while orgId is empty; a clear loading status, not a blank area
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status', { name: '調剤指標を読み込み中' })).toBeTruthy();
  });

  it('renders only the role-allowed surfaces it is given (nothing more)', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => dispensingSuccess()),
    );
    const onlyCockpit = STATISTICS_SURFACES.filter((surface) => surface.href === '/dashboard');

    render(<StatisticsContent surfaces={onlyCockpit} />, {
      wrapper: createQueryClientWrapper(),
    });

    // the one allowed card renders; a filtered-out admin surface does not
    expect(document.querySelector('a[href="/dashboard"]')).toBeTruthy();
    expect(document.querySelector('a[href="/admin/metrics"]')).toBeNull();
    expect(screen.queryByRole('heading', { name: '経営' })).toBeNull();
  });

  it('shows a single aggregated 「HH:mm 時点」 fetched-at stamp under the strip after a successful load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => dispensingSuccess()),
    );

    renderContent();

    expect(await screen.findByText('調剤 未着手')).toBeTruthy();
    // 取得時刻は各カード hint に散らさず、ストリップに 1 回だけ「HH:mm 時点」で集約表示する。
    const stamps = screen.getAllByText(/\d{2}:\d{2}\s*時点/);
    expect(stamps).toHaveLength(1);
  });

  it('shows one 最新化中 indicator during a background refetch while retaining the previous values', async () => {
    let call = 0;
    let releaseSecond: ((response: Response) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        call += 1;
        if (call === 1) return Promise.resolve(dispensingSuccess());
        // 2回目(背景再取得)はあえて解決させず in-flight(isFetching) 状態を保持する。
        return new Promise<Response>((resolve) => {
          releaseSecond = resolve;
        });
      }),
    );

    const queryClient = makeClient();
    renderWithClient(queryClient);

    expect(await screen.findByText('調剤 未着手')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();

    // 背景再取得を発火(解決は待たない = in-flight のまま検証)。
    act(() => {
      void queryClient.refetchQueries({ queryKey: ['statistics-dispensing-kpi', 'org_1'] });
    });

    // 集約された「最新化中…」が 1 つだけ出て、前回値(5/2/7)は維持される。
    expect(await screen.findByText('最新化中…')).toBeTruthy();
    expect(screen.getAllByText('最新化中…')).toHaveLength(1);
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();

    // クリーンアップ: hanging fetch を解放する。
    act(() => {
      releaseSecond?.(dispensingSuccess());
    });
  });
});
