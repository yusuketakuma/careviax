// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DocumentDeliveryRuleManager } from './document-delivery-rule-manager';

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
        expect.objectContaining({ method: 'DELETE', headers: { 'x-org-id': 'org_1' } }),
      );
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
});
