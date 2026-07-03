// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { TenantDirectoryContent } from './tenant-directory-content';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

setupDomTestEnv();

afterEach(() => {
  pushMock.mockReset();
  vi.unstubAllGlobals();
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderContent() {
  return render(<TenantDirectoryContent />, { wrapper: createWrapper() });
}

describe('TenantDirectoryContent', () => {
  it('renders the tenant list on successful fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              tenants: [
                {
                  id: 'org_1',
                  name: 'さくら薬局',
                  corporate_number: '1234567890123',
                  created_at: '2026-01-01T00:00:00.000Z',
                  member_count: 5,
                  site_count: 2,
                  active_break_glass: null,
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    renderContent();

    // DataTable renders both a desktop table and a mobile card list, so every
    // row's text appears twice in jsdom (only one is visible via CSS).
    await waitFor(() => expect(screen.getAllByText('さくら薬局').length).toBeGreaterThan(0));
    expect(screen.getAllByText('未アクセス').length).toBeGreaterThan(0);
  });

  it('shows an active break-glass badge instead of a false-empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              tenants: [
                {
                  id: 'org_2',
                  name: 'ひまわり薬局',
                  corporate_number: null,
                  created_at: '2026-01-01T00:00:00.000Z',
                  member_count: 3,
                  site_count: 1,
                  active_break_glass: {
                    id: 'bg_1',
                    expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
                    scope: 'read_only',
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    renderContent();

    await waitFor(() => expect(screen.getAllByText(/アクセス中/).length).toBeGreaterThan(0));
  });

  it('shows an ErrorState (not a false-empty table) when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: '取得に失敗しました' }), {
            status: 500,
          }),
      ),
    );

    renderContent();

    expect(await screen.findByText('テナント一覧を取得できませんでした')).toBeTruthy();
    expect(screen.queryByText('登録されているテナントがありません')).toBeNull();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
  });
});
