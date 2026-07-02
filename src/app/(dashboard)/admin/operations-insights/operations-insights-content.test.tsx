// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { OperationsInsightsContent } from './operations-insights-content';

const { useOrgIdMock } = vi.hoisted(() => ({
  useOrgIdMock: vi.fn(() => 'org_1'),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

setupDomTestEnv();

const OPERATIONS_BODY = {
  data: {
    monthly_visits: [
      { key: '2026-02', label: '2月', count: 0 },
      { key: '2026-03', label: '3月', count: 1 },
      { key: '2026-04', label: '4月', count: 3 },
      { key: '2026-05', label: '5月', count: 10 },
      { key: '2026-06', label: '6月', count: 14 },
    ],
    processes: [
      { key: 'audit', label: '監査', averageMinutes: 65, sampleCount: 4 },
      { key: 'visit', label: '訪問', averageMinutes: 120, sampleCount: 6 },
      { key: 'report', label: '報告', averageMinutes: 0, sampleCount: 0 },
    ],
    hints: ['「訪問」に最も時間がかかっています(平均120分)'],
  },
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderContent(queryClient = createQueryClient()) {
  return render(<OperationsInsightsContent />, {
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  });
}

function stubOperationsFetch(body = OPERATIONS_BODY, status = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('/api/admin/operations-insights');
    expect(init?.headers).toEqual({ 'x-org-id': 'org_1' });

    return new Response(
      status === 200 ? JSON.stringify(body) : 'stack: DATABASE_URL=secret raw prisma error',
      { status },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('OperationsInsightsContent', () => {
  beforeEach(() => {
    useOrgIdMock.mockReturnValue('org_1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the operations summary as non-interactive shared StatCards', async () => {
    const fetchMock = stubOperationsFetch();
    const queryClient = createQueryClient();

    renderContent(queryClient);

    expect(await screen.findByRole('heading', { name: '在宅業務の動きを見る' })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(queryClient.getQueryData(['admin-operations-insights', 'org_1'])).toEqual(
      OPERATIONS_BODY.data,
    );

    const kpis = screen.getByTestId('operations-insights-kpis');
    expect(within(kpis).queryByRole('button')).toBeNull();
    expect(kpis.querySelector('[data-role]')).toBeNull();

    for (const card of Array.from(kpis.children)) {
      const root = card as HTMLElement;
      expect(root.className).toContain('border-l-transparent');
      expect(root.className).not.toContain('bg-state-');
    }

    expect(within(kpis).getByText('6月の訪問')).toBeTruthy();
    expect(within(kpis).getByText('14').className).toContain('tabular-nums');
    expect(within(kpis).getAllByText('件').length).toBeGreaterThanOrEqual(2);
    expect(within(kpis).getByText('完了・再訪・配送のみを含む')).toBeTruthy();

    expect(within(kpis).getByText('前月差')).toBeTruthy();
    expect(within(kpis).getByText('+4').className).toContain('tabular-nums');
    expect(within(kpis).getByText('前月実績がある月だけ比較')).toBeTruthy();

    expect(within(kpis).getByText('最も時間がかかる工程')).toBeTruthy();
    expect(within(kpis).getByText('訪問 120分')).toBeTruthy();
    expect(within(kpis).getByText('直近30日の平均所要時間')).toBeTruthy();

    expect(within(kpis).getByText('次に見るところ')).toBeTruthy();
    expect(within(kpis).getByText('訪問の詰まりを確認')).toBeTruthy();
    expect(within(kpis).getByText('2工程に直近実績あり')).toBeTruthy();

    expect(screen.getByRole('img', { name: '月ごとの訪問件数' })).toBeTruthy();
    const processChart = screen.getByRole('img', { name: '工程ごとの平均所要分' });
    expect(processChart).toBeTruthy();
    expect(within(processChart).getByText('120分')).toBeTruthy();
    expect(screen.getByText('6月')).toBeTruthy();
    expect(screen.getByText('訪問')).toBeTruthy();
    expect(screen.getByText('「訪問」に最も時間がかかっています(平均120分)')).toBeTruthy();
  });

  it('keeps negative previous-month deltas split from the unit', async () => {
    stubOperationsFetch({
      data: {
        monthly_visits: [
          { key: '2026-05', label: '5月', count: 14 },
          { key: '2026-06', label: '6月', count: 10 },
        ],
        processes: [{ key: 'visit', label: '訪問', averageMinutes: 120, sampleCount: 6 }],
        hints: [],
      },
    });

    renderContent();

    const kpis = await screen.findByTestId('operations-insights-kpis');
    expect(within(kpis).getByText('前月差')).toBeTruthy();
    expect(within(kpis).getByText('-4').className).toContain('tabular-nums');
    expect(within(kpis).getAllByText('件').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps empty operations data truthful without fabricating trends', async () => {
    stubOperationsFetch({
      data: {
        monthly_visits: [],
        processes: [],
        hints: [],
      },
    });

    renderContent();

    const kpis = await screen.findByTestId('operations-insights-kpis');
    expect(within(kpis).getByText('比較なし')).toBeTruthy();
    expect(within(kpis).getByText('実績なし')).toBeTruthy();
    expect(within(kpis).getByText('直近実績を増やして傾向を確認')).toBeTruthy();
    expect(within(kpis).getByText('0工程に直近実績あり')).toBeTruthy();
    expect(screen.getByText('直近の実績が少ないため、ヒントはまだありません。')).toBeTruthy();
  });

  it('keeps the page shell visible and does not fetch until org id is available', () => {
    useOrgIdMock.mockReturnValue('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    expect(screen.getByRole('heading', { name: '在宅業務の動きを見る' })).toBeTruthy();
    expect(screen.getByRole('status', { name: '運用分析読み込み中' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on initial server errors and retries without leaking raw error text', async () => {
    const fetchMock = stubOperationsFetch(OPERATIONS_BODY, 500);

    renderContent();

    expect(await screen.findByText('運用分析を表示できません')).toBeTruthy();
    expect(screen.getByText('集計の取得に失敗しました。再試行してください。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '在宅業務の動きを見る' })).toBeTruthy();
    expect(screen.queryByText(/DATABASE_URL|raw prisma error|secret/)).toBeNull();
    expect(screen.queryByTestId('operations-insights-kpis')).toBeNull();
    expect(screen.queryByRole('img', { name: '月ごとの訪問件数' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
