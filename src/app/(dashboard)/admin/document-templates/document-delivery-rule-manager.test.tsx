// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
                  fallback_channels: ['email'],
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
});
