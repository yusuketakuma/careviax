// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DocumentDeliveryRuleManager } from './document-delivery-rule-manager';

setupDomTestEnv();

const orgIdMock = vi.hoisted(() => ({ value: 'org_1' }));
const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'x-test-org-id': orgId })),
);
const buildOrgJsonHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'Content-Type': 'application/json', 'x-test-json-org-id': orgId })),
);
vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => orgIdMock.value,
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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

function renderManager() {
  return render(<DocumentDeliveryRuleManager />, { wrapper: createWrapper() });
}

describe('DocumentDeliveryRuleManager', () => {
  beforeEach(() => {
    orgIdMock.value = 'org_1';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/document-delivery-rules' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'rule_1',
                  document_type: 'care_report',
                  target_role: 'physician',
                  channel: 'fax',
                  fallback_channels: ['mcs'],
                  is_active: true,
                },
                {
                  id: 'rule_2',
                  document_type: 'management_plan',
                  target_role: 'care_manager',
                  channel: 'email',
                  fallback_channels: ['fax'],
                  is_active: true,
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/document-delivery-rules/rule_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ message: '文書送達ルールを削除しました' }), {
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

  it('gives the active switch an accessible name from the visible setting label', async () => {
    renderManager();

    expect(await screen.findByRole('switch', { name: '有効化' })).toBeTruthy();
  });

  it('requires confirmation before deleting a delivery rule', async () => {
    renderManager();

    const deleteButton = await screen.findByRole('button', {
      name: '報告書 / 医師 / FAX の送達ルールを削除',
    });
    fireEvent.click(deleteButton);

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/document-delivery-rules/rule_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('alertdialog', { name: '送達ルールを削除しますか' })).toBeTruthy();
    expect(
      screen.getByText(
        '報告書 / 医師 / FAX の送達ルールを削除します。この操作は取り消せません。報告書詳細画面の送達候補にも反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/document-delivery-rules/rule_1',
        expect.objectContaining({ method: 'DELETE', headers: { 'x-test-org-id': 'org_1' } }),
      );
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('single-encodes delivery-rule update/delete paths and preserves payloads', async () => {
    const hostileId = 'rule/1?x=y#frag';
    const encodedId = encodeURIComponent(hostileId);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/document-delivery-rules' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: hostileId,
                  document_type: 'care_report',
                  target_role: 'physician',
                  channel: 'fax',
                  fallback_channels: ['mcs'],
                  is_active: true,
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === `/api/document-delivery-rules/${encodedId}` && init?.method) {
          return new Response(JSON.stringify({ data: { id: hostileId } }), { status: 200 });
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );

    renderManager();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '報告書 / 医師 / FAX の送達ルールを編集',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: '報告書 / 医師 / FAX の送達ルールを削除',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(
        vi
          .mocked(global.fetch)
          .mock.calls.filter(
            ([url]) => String(url) === `/api/document-delivery-rules/${encodedId}`,
          ),
      ).toHaveLength(2);
    });

    const mutationCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(
        ([url]) => String(url) === `/api/document-delivery-rules/${encodedId}`,
      ) as Array<[string, RequestInit]>;
    expect(mutationCalls.map(([, init]) => init.method)).toEqual(['PATCH', 'DELETE']);
    expect(mutationCalls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'x-test-json-org-id': 'org_1',
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    expect(JSON.parse(String(mutationCalls[0][1].body))).toEqual({
      document_type: 'care_report',
      target_role: 'physician',
      channel: 'fax',
      fallback_channels: ['mcs'],
      is_active: true,
    });
    expect(mutationCalls[1][1].headers).toEqual({ 'x-test-org-id': 'org_1' });
    for (const [url, init] of mutationCalls) {
      expect(url).not.toContain('%25');
      expect(String(init.body ?? '')).not.toContain(hostileId);
    }
  });

  it('uses shared collection paths and org headers for rule reads', async () => {
    renderManager();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/document-delivery-rules', {
        headers: { 'x-test-org-id': 'org_1' },
      });
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('creates delivery rules through the shared collection path and JSON org headers', async () => {
    renderManager();

    fireEvent.click(await screen.findByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/document-delivery-rules',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-test-json-org-id': 'org_1' },
        }),
      );
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const createCall = vi
      .mocked(global.fetch)
      .mock.calls.find(
        ([url, init]) =>
          String(url) === '/api/document-delivery-rules' &&
          (init as RequestInit | undefined)?.method === 'POST',
      ) as [string, RequestInit] | undefined;
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String(createCall?.[1].body))).toEqual({
      document_type: 'care_report',
      target_role: 'physician',
      channel: 'fax',
      fallback_channels: ['email'],
      is_active: true,
    });
  });

  it('names the edit action and loads the selected delivery rule into the form', async () => {
    renderManager();

    expect(
      await screen.findByRole('button', {
        name: '報告書 / 医師 / FAX の送達ルールを編集',
      }),
    ).toBeTruthy();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '計画書 / ケアマネ / メール の送達ルールを編集',
      }),
    );

    expect(screen.getByText('送達ルールを編集')).toBeTruthy();
    expect(screen.getByRole('button', { name: '更新する' })).toBeTruthy();
    expect((screen.getByLabelText('フォールバック順') as HTMLInputElement).value).toBe('fax');
  });

  it('renders the form and list panel titles as real h3 headings (scoped to the manager)', async () => {
    const { container } = renderManager();

    // 一覧 panel の描画を待ってから、manager コンテナ内に scope して h3 を検証する
    // (将来 parent PageSection が同名 h2 を出しても誤検出しないように container scope)。
    await screen.findByText('送達ルール一覧');
    const scope = within(container);
    expect(scope.getByRole('heading', { level: 3, name: '送達ルールを登録' })).toBeTruthy();
    expect(scope.getByRole('heading', { level: 3, name: '送達ルール一覧' })).toBeTruthy();
  });

  it('surfaces hidden delivery-rule counts when the API response is truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/document-delivery-rules' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'rule_visible',
                  document_type: 'care_report',
                  target_role: 'physician',
                  channel: 'fax',
                  fallback_channels: ['mcs'],
                  is_active: true,
                },
              ],
              total_count: 3,
              visible_count: 1,
              hidden_count: 2,
              truncated: true,
              count_basis: 'document_delivery_rules',
              filters_applied: { document_type: null },
              limit: 1,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );

    renderManager();

    expect(await screen.findByText('先頭1件を表示 / 他2件')).toBeTruthy();
    expect(
      screen.getByText(
        '文書送達ルールは上限内の先頭行だけを表示しています。未表示のルールが報告書送達候補に影響する可能性があります。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('登録1件')).toBeNull();
  });

  it('fails closed with a retryable error instead of an empty-state when the rules fetch fails', async () => {
    // A failed rules fetch must not render the "文書送達ルールはまだありません。" empty-state — that
    // false-empty reads as "no delivery rules" and would skew report delivery-channel suggestions.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/document-delivery-rules' && !init?.method) {
          return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );
    renderManager();

    // the error title is an h4 (nested under the h3 一覧 panel) — not a default h2 that would
    // regress the heading hierarchy.
    expect(
      await screen.findByRole('heading', { level: 4, name: '送達ルールを取得できませんでした' }),
    ).toBeTruthy();
    expect(screen.queryByText('文書送達ルールはまだありません。')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: '再試行' }));
    await waitFor(() => {
      const ruleCalls = vi
        .mocked(global.fetch)
        .mock.calls.filter(
          ([u, i]) =>
            String(u) === '/api/document-delivery-rules' && !(i as RequestInit | undefined)?.method,
        );
      expect(ruleCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows a loading state instead of the empty-state while the rules fetch is pending', () => {
    // A deferred (never-resolving) fetch keeps the query in its loading state. The empty-state
    // copy must NOT show during loading — that would be a false-empty (loading read as "no rules").
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderManager();

    expect(screen.getByRole('status', { name: '送達ルールを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('送達ルールを読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('文書送達ルールはまだありません。')).toBeNull();
  });

  it('shows loading (not the empty-state) while orgId is unresolved and the query is disabled', () => {
    // useOrgId returns '' until the auth store resolves, so enabled: !!orgId keeps the query
    // pending-but-not-fetching (isPending true, isLoading false). The empty-state must not show.
    orgIdMock.value = '';
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderManager();

    expect(screen.getByRole('status', { name: '送達ルールを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('送達ルールを読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('文書送達ルールはまだありません。')).toBeNull();
    // the disabled query must not have fired a fetch
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
