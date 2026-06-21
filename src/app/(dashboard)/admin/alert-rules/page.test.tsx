// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import AlertRulesPage from './page';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('./signal-tuning-panel', () => ({
  SignalTuningPanel: () => <div data-testid="signal-tuning-panel" />,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderPage() {
  return render(<AlertRulesPage />, { wrapper: createWrapper() });
}

describe('AlertRulesPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/drug-alert-rules' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'rule_1',
                  org_id: 'org_1',
                  alert_type: 'interaction',
                  condition: { severity: 'high' },
                  severity: 'warning',
                  message: '併用禁忌候補を再確認してください',
                  is_active: true,
                  updated_at: '2026-06-19T10:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/drug-alert-rules/rule_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ message: '処方安全アラートルールを削除しました' }), {
            status: 200,
          });
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires confirmation before deleting an alert rule', async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' }),
    );

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/drug-alert-rules/rule_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(
      screen.getByRole('alertdialog', { name: '処方安全アラートルールを削除しますか' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '相互作用（warning）の組織ルールを削除します。この操作は取り消せません。処方安全チェックの表示に反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/drug-alert-rules/rule_1',
        expect.objectContaining({ method: 'DELETE', headers: { 'x-org-id': 'org_1' } }),
      );
    });
  });

  it('names the edit action and loads the selected alert rule into the form', async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを編集' }),
    );

    expect(screen.getByRole('button', { name: '更新する' })).toBeTruthy();
    expect((screen.getByLabelText('表示メッセージ') as HTMLInputElement).value).toBe(
      '併用禁忌候補を再確認してください',
    );
    expect((screen.getByLabelText('条件(JSON)') as HTMLTextAreaElement).value).toContain(
      '"severity": "high"',
    );
  });

  it('shows ErrorState (not a false-empty) with retry when the rules query fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    renderPage();

    // 取得失敗 → 空状態ではなく ErrorState（サーバーエラー）+ 再読み込み。
    expect(await screen.findByText('サーバーエラーが発生しました')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    // false-empty（「まだ…ありません」）を出していないこと。
    expect(screen.queryByText('まだ処方安全アラートルールはありません。')).toBeNull();
  });

  it('retry re-runs the rules query (calls fetch again)', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await screen.findByText('サーバーエラーが発生しました');
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('shows true-empty only when no rules are returned (and no error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    renderPage();

    expect(await screen.findByText('まだ処方安全アラートルールはありません。')).toBeTruthy();
    expect(screen.queryByText('サーバーエラーが発生しました')).toBeNull();
  });
});
