// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PharmacySitesContent } from './pharmacy-sites-content';

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
  return render(<PharmacySitesContent />, { wrapper: createWrapper() });
}

describe('PharmacySitesContent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === '/api/pharmacy-sites') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'site_1',
                  name: '本店',
                  address: '東京都千代田区1-1',
                  phone: '03-1111-2222',
                  fax: '03-1111-2223',
                  is_health_support_pharmacy: true,
                  is_regional_support: false,
                  is_specialized_pharmacy: false,
                  dispensing_fee_category: null,
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/pharmacy-sites/site_1/insurance-configs') {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('associates visible labels with pharmacy site edit fields', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '編集' }));

    expect(screen.getByLabelText('薬局名')).toBeTruthy();
    expect(screen.getByLabelText('住所')).toBeTruthy();
    expect(screen.getByLabelText('電話番号')).toBeTruthy();
    expect(screen.getByLabelText('FAX')).toBeTruthy();
  });

  it('associates visible labels with insurance config fields', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '保険設定' }));
    fireEvent.click(await screen.findByRole('button', { name: '設定を追加' }));

    expect(screen.getByLabelText('保険種別')).toBeTruthy();
    expect(screen.getByLabelText('改定年度')).toBeTruthy();
    expect(screen.getByLabelText('施行日')).toBeTruthy();
    expect(screen.getByLabelText('終了日（空欄=現行）')).toBeTruthy();
  });
});
