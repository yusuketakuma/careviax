// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DocumentTemplateContent } from './template-content';

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

vi.mock('./document-delivery-rule-manager', () => ({
  DocumentDeliveryRuleManager: () => <div data-testid="delivery-rule-manager" />,
}));

vi.mock('./template-body-editor', () => ({
  TemplateBodyEditor: () => <div data-testid="template-body-editor" />,
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
  return render(<DocumentTemplateContent />, { wrapper: createWrapper() });
}

describe('DocumentTemplateContent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/templates' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'template_1',
                  name: '主治医報告 基本',
                  template_type: 'care_report',
                  target_role: 'physician',
                  format: 'html',
                  version: 2,
                  effective_from: null,
                  effective_to: null,
                  content: { sections: ['summary'] },
                  is_default: true,
                  created_at: '2026-06-19T10:00:00.000Z',
                  updated_at: '2026-06-19T10:30:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/templates/template_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ message: 'テンプレートを削除しました' }), {
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

  it('requires confirmation before deleting a document template', async () => {
    renderContent();

    const [deleteButton] = await screen.findAllByRole('button', {
      name: '主治医報告 基本 を削除',
    });
    fireEvent.click(deleteButton);

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/templates/template_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('alertdialog', { name: 'テンプレートを削除しますか' })).toBeTruthy();
    expect(
      screen.getByText(
        '主治医報告 基本（報告書 v2）を削除します。この操作は取り消せません。送付や印刷で参照しているテンプレート版を確認してから削除してください。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/templates/template_1',
        expect.objectContaining({ method: 'DELETE', headers: { 'x-org-id': 'org_1' } }),
      );
    });
  });

  it('names the edit action and loads the selected template into the form', async () => {
    renderContent();

    const [editButton] = await screen.findAllByRole('button', {
      name: '主治医報告 基本 を編集',
    });
    fireEvent.click(editButton);

    expect(screen.getByRole('button', { name: '更新する' })).toBeTruthy();
    expect((screen.getByLabelText('テンプレート名') as HTMLInputElement).value).toBe(
      '主治医報告 基本',
    );
    expect((screen.getByLabelText('版') as HTMLInputElement).value).toBe('2');
  });
});
