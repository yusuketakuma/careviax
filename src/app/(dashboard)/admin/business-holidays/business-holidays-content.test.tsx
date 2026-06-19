// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { BusinessHolidaysContent } from './business-holidays-content';

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

function renderContent() {
  return render(<BusinessHolidaysContent />, { wrapper: createWrapper() });
}

describe('BusinessHolidaysContent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/pharmacy-sites') {
          return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
            status: 200,
          });
        }

        if (url.startsWith('/api/business-holidays?')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'holiday_1',
                  org_id: 'org_1',
                  site_id: 'site_1',
                  date: '2026-01-01',
                  name: '年始休業',
                  holiday_type: 'site_closure',
                  is_closed: true,
                  site: { id: 'site_1', name: '本店' },
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/business-holidays/holiday_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ message: '休日を削除しました' }), { status: 200 });
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires confirmation before deleting a business holiday', async () => {
    renderContent();

    expect(await screen.findByLabelText('店舗フィルタ')).toBeTruthy();
    expect(screen.getByRole('button', { name: '前月を表示' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '翌月を表示' })).toBeTruthy();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を削除',
      }),
    );

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/business-holidays/holiday_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('alertdialog', { name: '休日設定を削除しますか' })).toBeTruthy();
    expect(
      screen.getByText(
        '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を削除します。この操作は取り消せません。シフト表と訪問可能日の表示にも反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/business-holidays/holiday_1',
        expect.objectContaining({ method: 'DELETE', headers: { 'x-org-id': 'org_1' } }),
      );
    });
  });
});
