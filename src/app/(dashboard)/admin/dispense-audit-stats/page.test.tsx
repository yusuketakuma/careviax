// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import DispenseAuditStatsPage from './page';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

const okStats = {
  data: {
    total_rejected: 12,
    period_days: 30,
    breakdown: [{ code: 'quantity_error', label: '数量エラー', count: 7, percentage: 58 }],
  },
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderPage() {
  return render(<DispenseAuditStatsPage />, { wrapper: createWrapper() });
}

describe('DispenseAuditStatsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders aggregate stats on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(okStats), { status: 200 })),
    );
    renderPage();
    expect(await screen.findByText('12')).toBeTruthy();
    expect(screen.getByText('数量エラー')).toBeTruthy();
    expect(screen.queryByText('最初に見るポイント')).toBeNull();
    for (const label of ['7日', '30日', '90日']) {
      const button = screen.getByRole('button', { name: label });
      expect(button.className).toContain('!h-11');
      expect(button.className).toContain('!min-h-[44px]');
    }
  });

  it('shows ErrorState (not a false-empty) with a retry when the query fails', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    // 取得失敗 → 空状態ではなく ErrorState（サーバーエラー）+ 再読み込み。
    expect(await screen.findByText('サーバーエラーが発生しました')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    // false-empty を出していないこと。
    expect(screen.queryByText('データがありません')).toBeNull();
  });

  it('retry re-runs the query (calls fetch again)', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await screen.findByText('サーバーエラーが発生しました');
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('shows true-empty only when the response carries no stats (and no error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    renderPage();
    expect(await screen.findByText('データがありません')).toBeTruthy();
    expect(screen.queryByText('サーバーエラーが発生しました')).toBeNull();
  });
});
