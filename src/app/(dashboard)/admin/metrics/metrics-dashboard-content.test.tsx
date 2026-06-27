// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { MetricsDashboardContent } from './metrics-dashboard-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

setupDomTestEnv();

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWith(queryClient: QueryClient) {
  return render(<MetricsDashboardContent />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(METRICS_BODY), { status: 200 })),
    );

    renderWith(makeClient());

    expect(await screen.findByText('処方箋集中率')).toBeTruthy();
    expect(screen.getByText('後発医薬品調剤割合')).toBeTruthy();
    expect(screen.queryByText(/未達/)).toBeNull();
    expect(screen.queryByText(/超過/)).toBeNull();
    // 実データ時はサンプル/未接続バナーを出さない。
    expect(screen.queryByTestId('metrics-placeholder-notice')).toBeNull();
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

  it('preserves the placeholder WITHOUT firing threshold alerts on a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );

    const { container } = renderWith(makeClient());

    // 404 = legitimate "no data yet": placeholder cards render, not an error.
    expect(await screen.findByText('処方箋集中率')).toBeTruthy();
    expect(screen.queryByText(ERROR_DESCRIPTION)).toBeNull();
    // 「サンプル/未接続」を明示するバナーを出し、0 値を実測と誤読させない。
    expect(screen.getByTestId('metrics-placeholder-notice')).toBeTruthy();
    expect(screen.getByText('サンプル表示（実データ未接続）')).toBeTruthy();
    // placeholder zeros must NOT be reported as below-threshold (false alert) —
    // neither via alert text nor via a warning-colored progress segment.
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
    // 前回値は実データなので、サンプル/未接続バナーは出さない。
    expect(screen.queryByTestId('metrics-placeholder-notice')).toBeNull();
  });
});
