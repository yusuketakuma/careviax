// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { TemplateBodyEditor } from './template-body-editor';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function renderEditor(templateId = 'template_1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(
    <TemplateBodyEditor
      templates={[{ id: templateId, name: '主治医報告 基本', content: { body_text: '本文' } }]}
    />,
    { wrapper: Wrapper },
  );
}

describe('TemplateBodyEditor render hierarchy', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes one h2 region heading with h3 column subheadings (no inner h2 regression)', () => {
    renderEditor();

    // section は aria-labelledby で外側見出しと結ばれた named region。
    const region = screen.getByRole('region', { name: '報告文面を編集' });
    const scope = within(region);

    // 外側は h2、内側3カラム(テンプレート/文面を編集/差し込み項目)は h3。
    expect(scope.getByRole('heading', { level: 2, name: '報告文面を編集' })).toBeTruthy();
    expect(scope.getByRole('heading', { level: 3, name: 'テンプレート' })).toBeTruthy();
    expect(scope.getByRole('heading', { level: 3, name: '文面を編集' })).toBeTruthy();
    expect(scope.getByRole('heading', { level: 3, name: '差し込み項目' })).toBeTruthy();

    // 内側パネルが h2 に退行していないこと(見出しアウトラインの回帰防止)。
    expect(scope.queryByRole('heading', { level: 2, name: 'テンプレート' })).toBeNull();
  });

  it('single-encodes the selected template id when saving body text', async () => {
    const hostileId = 'template/1?x=y#frag';
    const encodedId = encodeURIComponent(hostileId);
    renderEditor(hostileId);

    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/templates/${encodedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({ content: { body_text: '本文' } }),
      });
    });
    expect(String(vi.mocked(global.fetch).mock.calls[0][0])).not.toContain('%25');
  });
});
