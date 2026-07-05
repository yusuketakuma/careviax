// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { TemplateBodyEditor } from './template-body-editor';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function renderEditor(templateId = 'template_1') {
  return render(<TemplateBodyEditor templates={[{ id: templateId, name: '主治医報告 基本' }]} />, {
    wrapper: createQueryClientWrapper(),
  });
}

describe('TemplateBodyEditor render hierarchy', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!init?.method) {
          return new Response(
            JSON.stringify({
              data: {
                id: 'template_1',
                name: '主治医報告 基本',
                content: { body_text: '本文', sections: ['summary'] },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              id: url.split('/').pop(),
              content: JSON.parse(String(init.body)).content,
            },
          }),
          { status: 200 },
        );
      }),
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return new Response(
            JSON.stringify({
              data: {
                id: hostileId,
                name: '主治医報告 基本',
                content: { body_text: '本文', sections: ['summary'] },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: { id: hostileId } }), { status: 200 });
      }),
    );
    renderEditor(hostileId);

    await screen.findByDisplayValue('本文');
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(`/api/templates/${encodedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
        body: JSON.stringify({ content: { body_text: '本文', sections: ['summary'] } }),
      });
    });
    expect(String(vi.mocked(global.fetch).mock.calls.at(-1)?.[0])).not.toContain('%25');
  });

  it('keeps server save error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return new Response(
            JSON.stringify({
              data: {
                id: 'template_1',
                name: '主治医報告 基本',
                content: { body_text: '本文', sections: ['summary'] },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ message: 'テンプレートが更新されています' }), {
          status: 409,
        });
      }),
    );
    renderEditor();

    await screen.findByDisplayValue('本文');
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('テンプレートが更新されています');
    });
  });

  it('keeps body editing disabled when template detail loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: '文書テンプレートが見つかりません' }), {
            status: 404,
          }),
      ),
    );
    renderEditor();

    expect(await screen.findByText('文書テンプレートが見つかりません')).toBeTruthy();
    expect(screen.queryByDisplayValue('本文')).toBeNull();
    expect(screen.queryByDisplayValue(/本日の訪問では/)).toBeNull();
    expect((screen.getByLabelText('テンプレート文面') as HTMLTextAreaElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: '本文を保存する' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps server save error envelopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return new Response(
            JSON.stringify({
              data: {
                id: 'template_1',
                name: '主治医報告 基本',
                content: { body_text: '本文', sections: ['summary'] },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: '文書テンプレートの更新権限がありません' }), {
          status: 403,
        });
      }),
    );
    renderEditor();

    await screen.findByDisplayValue('本文');
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('文書テンプレートの更新権限がありません');
    });
  });

  it('falls back to the save message when PATCH fails without a message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return new Response(
            JSON.stringify({
              data: {
                id: 'template_1',
                name: '主治医報告 基本',
                content: { body_text: '本文', sections: ['summary'] },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 500 });
      }),
    );
    renderEditor();

    await screen.findByDisplayValue('本文');
    fireEvent.click(screen.getByRole('button', { name: '本文を保存する' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('文面の保存に失敗しました');
    });
  });
});
