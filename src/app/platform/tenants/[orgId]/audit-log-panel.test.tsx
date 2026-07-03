// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { AuditLogPanel } from './audit-log-panel';

setupDomTestEnv();

afterEach(() => {
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

describe('AuditLogPanel', () => {
  it('renders entries on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              entries: [
                {
                  id: 'a1',
                  actor_id: 'user_1',
                  action: 'break_glass_activate',
                  target_type: 'break_glass_session',
                  target_id: 'bg_1',
                  changes: { reason: '障害調査のため確認します' },
                  ip_address: '127.0.0.1',
                  created_at: '2026-01-01T00:00:00.000Z',
                },
              ],
              truncated: false,
            }),
            { status: 200 },
          ),
      ),
    );

    render(<AuditLogPanel orgId="org_1" />, { wrapper: createWrapper() });

    // DataTable renders both a desktop table and a mobile card list, so every
    // row's text appears twice in jsdom.
    await waitFor(() => expect(screen.getAllByText('起動').length).toBeGreaterThan(0));
    expect(screen.getAllByText('障害調査のため確認します').length).toBeGreaterThan(0);
  });

  it('shows a forbidden ErrorState (not a false-empty table) when there is no active session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'AUTH_FORBIDDEN',
              message: 'このテナントの有効なブレークグラスセッションがありません',
            }),
            { status: 403 },
          ),
      ),
    );

    render(<AuditLogPanel orgId="org_1" />, { wrapper: createWrapper() });

    expect(await screen.findByText('監査ログを表示できません')).toBeTruthy();
    expect(
      screen.queryByText('このテナントへのブレークグラスアクセス履歴はまだありません'),
    ).toBeNull();
  });

  it('shows a generic server ErrorState on a non-403 failure, with retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: '失敗しました' }), {
            status: 500,
          }),
      ),
    );

    render(<AuditLogPanel orgId="org_1" />, { wrapper: createWrapper() });

    expect(await screen.findByText('監査ログを取得できませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
  });
});
