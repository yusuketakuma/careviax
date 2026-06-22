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

// Base UI Select renders a portaled listbox that jsdom can't drive; mock it to a native
// <select> (carrying the trigger's id + className) so existing label/value assertions keep
// working and the >=44px touch-target class contract can be asserted.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  function collectItems(children: ReactNode): Array<{ value: string; label: string }> {
    const items: Array<{ value: string; label: string }> = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: string; children?: ReactNode };
      if (props.value) {
        items.push({ value: props.value, label: React.Children.toArray(props.children).join('') });
      }
      items.push(...collectItems(props.children));
    });
    return items;
  }

  type TriggerProps = {
    id?: string;
    className?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    children?: ReactNode;
  };

  function findTriggerProps(children: ReactNode): TriggerProps | undefined {
    let triggerProps: TriggerProps | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as TriggerProps;
      if (props.id) triggerProps = props;
      if (!triggerProps) triggerProps = findTriggerProps(props.children);
    });
    return triggerProps;
  }

  function MockSelect({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) {
    const triggerProps = findTriggerProps(children);
    return (
      <select
        id={triggerProps?.id}
        className={triggerProps?.className}
        aria-describedby={triggerProps?.['aria-describedby']}
        aria-invalid={triggerProps?.['aria-invalid']}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {collectItems(children).map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    );
  }

  return {
    Select: MockSelect,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder ?? null}</>,
  };
});

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

  it('gives the site and area-type selects a >=44px touch target at all breakpoints (WCAG)', async () => {
    renderPage();

    await screen.findByRole('option', { name: '本店' });

    // 共有 SelectTrigger の既定は sm で min-h-0/h-8 へ縮むため、ページ側の sm:min-h-[44px]
    // 上書きまで assert し、将来このデスクトップ 44px 契約が落ちる退行を捕捉する。
    for (const label of ['拠点', 'エリア種別']) {
      const className = screen.getByLabelText(label).className;
      expect(className).toContain('min-h-[44px]');
      expect(className).toContain('sm:min-h-[44px]');
    }
  });
});
