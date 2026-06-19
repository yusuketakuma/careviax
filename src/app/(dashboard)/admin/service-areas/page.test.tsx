// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import ServiceAreasPage from './page';

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

function renderPage() {
  return render(<ServiceAreasPage />, { wrapper: createWrapper() });
}

describe('ServiceAreasPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/pharmacy-sites') {
          return new Response(
            JSON.stringify({
              data: [{ id: 'site_1', name: '本店' }],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/service-areas' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'area_1',
                  site_id: 'site_1',
                  name: '北多摩エリア',
                  area_type: 'radius',
                  geo_data: { match_keywords: ['北多摩'] },
                  notes: '16km 圏確認済み',
                  site: { id: 'site_1', name: '本店' },
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/service-areas/area_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ message: '訪問エリアを削除しました' }), {
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

  it('explains service area save blockers before mutation', async () => {
    renderPage();

    await screen.findByRole('option', { name: '本店' });
    const saveButton = screen.getByRole('button', { name: '登録する' }) as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe('service-area-save-blocker');
    expect(screen.getByText('拠点を選択してください。')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('拠点'), { target: { value: 'site_1' } });
    fireEvent.change(screen.getByLabelText('エリア名'), { target: { value: '   ' } });

    expect(saveButton.disabled).toBe(true);
    expect(screen.getByText('エリア名を入力してください。')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('エリア名'), { target: { value: '新規エリア' } });
    fireEvent.change(screen.getByLabelText('エリア定義(JSON)'), { target: { value: '[]' } });

    expect(saveButton.disabled).toBe(true);
    expect(screen.getByLabelText('エリア定義(JSON)').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('service-area-geo-error')?.textContent).toBe(
      'エリア定義(JSON) の形式が不正です',
    );
    expect(document.getElementById('service-area-save-blocker')?.textContent).toBe(
      'エリア定義(JSON) の形式が不正です',
    );
  });

  it('requires confirmation before deleting a service area', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を削除' }));

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/service-areas/area_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('alertdialog', { name: '訪問エリアを削除しますか' })).toBeTruthy();
    expect(
      screen.getByText(
        '北多摩エリア（本店 / radius）を削除します。この操作は取り消せません。患者登録時の訪問エリア警告にも反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/service-areas/area_1',
        expect.objectContaining({ method: 'DELETE', headers: { 'x-org-id': 'org_1' } }),
      );
    });
  });

  it('names edit actions by service area and loads that row into the form', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '北多摩エリア（本店）を編集' }));

    expect(screen.getByText('訪問エリアを編集')).toBeTruthy();
    expect((screen.getByLabelText('エリア名') as HTMLInputElement).value).toBe('北多摩エリア');
    expect((screen.getByLabelText('エリア種別') as HTMLSelectElement).value).toBe('radius');
    expect((screen.getByLabelText('備考') as HTMLTextAreaElement).value).toBe('16km 圏確認済み');
  });
});
