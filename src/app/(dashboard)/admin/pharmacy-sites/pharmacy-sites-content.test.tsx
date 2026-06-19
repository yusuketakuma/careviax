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
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'config_2024_medical',
                  site_id: 'site_1',
                  insurance_type: 'medical',
                  revision_code: '2024',
                  revision_label: '令和6年度改定',
                  effective_from: '2024-06-01',
                  effective_to: null,
                  config: {},
                },
              ],
            }),
            { status: 200 },
          );
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

    fireEvent.click(await screen.findByRole('button', { name: '本店の薬局情報を編集' }));

    expect(screen.getByLabelText('薬局名')).toBeTruthy();
    expect(screen.getByLabelText('住所')).toBeTruthy();
    expect(screen.getByLabelText('電話番号')).toBeTruthy();
    expect(screen.getByLabelText('FAX')).toBeTruthy();
  });

  it('associates visible labels with insurance config fields', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を追加' }));

    expect(screen.getByLabelText('保険種別')).toBeTruthy();
    expect(screen.getByLabelText('改定年度')).toBeTruthy();
    expect(screen.getByLabelText('施行日')).toBeTruthy();
    expect(screen.getByLabelText('終了日（空欄=現行）')).toBeTruthy();
  });

  it('names repeated insurance config actions by target', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));

    expect(
      await screen.findByRole('button', { name: '医療保険 2024から2026設定を作成' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '医療保険 2024の保険設定を編集' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '医療保険 2024の保険設定を削除' }));

    expect(screen.getByText(/医療保険 2024の保険設定を削除します/)).toBeTruthy();
  });

  it('blocks insurance config ranges that end before the effective date', async () => {
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を開く' }));
    fireEvent.click(await screen.findByRole('button', { name: '本店の保険設定を追加' }));

    const effectiveFrom = screen.getByLabelText('施行日') as HTMLInputElement;
    const effectiveTo = screen.getByLabelText('終了日（空欄=現行）') as HTMLInputElement;
    const submit = screen.getByRole('button', { name: '登録する' }) as HTMLButtonElement;

    fireEvent.change(effectiveFrom, { target: { value: '2026-06-01' } });
    fireEvent.change(effectiveTo, { target: { value: '2026-06-01' } });

    expect(effectiveFrom.max).toBe('2026-05-31');
    expect(effectiveTo.min).toBe('2026-06-02');
    expect(effectiveTo.getAttribute('aria-invalid')).toBe('true');
    expect(effectiveTo.getAttribute('aria-describedby')).toContain(
      'insurance-config-effective-to-error',
    );
    expect(screen.getAllByText('終了日は施行日より後の日付を指定してください。')).toHaveLength(2);
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('aria-describedby')).toBe('insurance-config-save-blocker');

    fireEvent.click(submit);
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/pharmacy-sites/site_1/insurance-configs',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
