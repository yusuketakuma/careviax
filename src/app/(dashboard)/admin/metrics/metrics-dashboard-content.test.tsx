// @vitest-environment jsdom

import type { QueryClient } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { MetricsDashboardContent } from './metrics-dashboard-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

function makeClient() {
  return createTestQueryClient();
}

function renderWith(queryClient: QueryClient) {
  return render(<MetricsDashboardContent />, {
    wrapper: createQueryClientWrapper(queryClient),
  });
}

const ERROR_DESCRIPTION = '経営指標を取得できませんでした。時間をおいて再度お試しください。';
const STALE_WARNING = '最新の経営指標を取得できませんでした。表示は前回取得した値です。';

const METRICS_BODY = {
  data: {
    prescription_concentration_rate: 65,
    generic_dispensing_rate: 82, // >= GENERIC_TARGET(70) -> no 未達 alert
    prescriptions_per_pharmacist: 35, // <= PRESCRIPTIONS_LIMIT(40) -> no 超過 alert
    home_visit_count_ytd: 50,
    monthly_prescription_count: 1200,
  },
};

describe('MetricsDashboardContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the metric cards on a successful fetch', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(METRICS_BODY), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWith(makeClient());

    expect(await screen.findByText('処方箋集中率')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/metrics', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(screen.getByText('後発医薬品調剤割合')).toBeTruthy();
    expect(screen.queryByText(/未達/)).toBeNull();
    expect(screen.queryByText(/超過/)).toBeNull();
    expect(screen.queryByText('サンプル表示（実データ未接続）')).toBeNull();
  });

  it('shows a confirm-severity alert when the generic dispensing rate is below target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: { ...METRICS_BODY.data, generic_dispensing_rate: 60 } }),
            { status: 200 },
          ),
      ),
    );

    const { container } = renderWith(makeClient());

    const alertEl = (await screen.findByText(/未達/)).closest('p');
    expect(alertEl?.className).toContain('text-state-confirm');
    // 目標未達は confirm のみ。blocked(赤)文字は出ない。
    expect(container.querySelector('.text-state-blocked')).toBeNull();
  });

  it('shows a blocked-severity alert when prescriptions per pharmacist exceed the limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: { ...METRICS_BODY.data, prescriptions_per_pharmacist: 55 } }),
            { status: 200 },
          ),
      ),
    );

    renderWith(makeClient());

    const alertEl = (await screen.findByText(/超過/)).closest('p');
    expect(alertEl?.className).toContain('text-state-blocked');
  });

  it('renders a blocking error state (no cards, no fabricated alerts) on a first-load failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('error', { status: 500 })),
    );

    renderWith(makeClient());

    expect(await screen.findByText(ERROR_DESCRIPTION)).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    expect(screen.queryByText('処方箋集中率')).toBeNull();
    expect(screen.queryByText(/未達/)).toBeNull();
    expect(screen.queryByText(/超過/)).toBeNull();
  });

  it('renders a blocking error instead of all-zero sample cards on a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );

    renderWith(makeClient());

    expect(await screen.findByText(ERROR_DESCRIPTION)).toBeTruthy();
    expect(screen.queryByText('処方箋集中率')).toBeNull();
    expect(screen.queryByText('サンプル表示（実データ未接続）')).toBeNull();
    expect(screen.queryByText(/未達/)).toBeNull();
    expect(screen.queryByText(/超過/)).toBeNull();
  });

  it('renders real zero metrics without sample text or threshold alerts when there is no monthly volume', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                prescription_concentration_rate: 0,
                generic_dispensing_rate: 0,
                prescriptions_per_pharmacist: 0,
                home_visit_count_ytd: 0,
                monthly_prescription_count: 0,
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const { container } = renderWith(makeClient());

    expect(await screen.findByText('処方箋集中率')).toBeTruthy();
    expect(screen.queryByText('サンプル表示（実データ未接続）')).toBeNull();
    expect(screen.queryByText(/未達/)).toBeNull();
    expect(screen.queryByText(/超過/)).toBeNull();
    expect(container.querySelector('.bg-state-confirm')).toBeNull();
  });

  it('keeps the last metrics and shows a non-blocking warning when a refetch fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? new Response(JSON.stringify(METRICS_BODY), { status: 200 })
          : new Response('error', { status: 500 });
      }),
    );

    const queryClient = makeClient();
    renderWith(queryClient);

    expect(await screen.findByText('処方箋集中率')).toBeTruthy();

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin-metrics', 'org_1'] });
    });

    // stale data is retained (NOT wiped by a blocking error state) ...
    expect(screen.getByText('処方箋集中率')).toBeTruthy();
    expect(screen.queryByText(ERROR_DESCRIPTION)).toBeNull();
    // ... and a non-blocking refetch warning + retry is shown instead.
    expect(await screen.findByText(STALE_WARNING)).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    expect(screen.queryByText('サンプル表示（実データ未接続）')).toBeNull();
  });
});
