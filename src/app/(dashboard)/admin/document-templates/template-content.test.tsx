// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DocumentTemplateContent } from './template-content';

setupDomTestEnv();

const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'x-test-org-id': orgId })),
);
const buildOrgJsonHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'Content-Type': 'application/json', 'x-test-json-org-id': orgId })),
);

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
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

// 親(DocumentTemplateContent)が取得済みテンプレートを正しい形で渡しているときだけ
// sentinel を描画する field-validating mock。実コンポーネントは空配列で null を返すため
// (template-body-editor.tsx)、親が templates を渡さない/[] を渡す/誤マッピングした場合に
// 親の DOM 順序テストが fail closed する。
vi.mock('./template-body-editor', () => ({
  TemplateBodyEditor: ({
    templates,
  }: {
    templates: Array<{ id: string; name: string; content: Record<string, unknown> }>;
  }) => {
    const first = templates[0];
    const sections =
      first && typeof first.content === 'object' && first.content !== null
        ? (first.content as { sections?: unknown }).sections
        : undefined;
    const matches =
      templates.length > 0 &&
      first.id === 'template_1' &&
      first.name === '主治医報告 基本' &&
      Array.isArray(sections) &&
      sections[0] === 'summary';
    return matches ? <h2 data-testid="body-editor-sentinel">報告文面を編集</h2> : null;
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
              total_count: 3,
              visible_count: 1,
              hidden_count: 2,
              truncated: true,
              count_basis: 'templates',
              filters_applied: { template_type: null, target_role: null },
              limit: 1,
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
        expect.objectContaining({ method: 'DELETE', headers: { 'x-test-org-id': 'org_1' } }),
      );
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('surfaces hidden document template counts from the bounded template list', async () => {
    renderContent();

    expect(await screen.findByText('先頭1件を表示 / 他2件')).toBeTruthy();
    expect(screen.getByText(/表示上限 1 件に達しています/)).toBeTruthy();
    expect(screen.getByText(/非表示のテンプレートを確認できます/)).toBeTruthy();
  });

  it('single-encodes template update paths and preserves payloads', async () => {
    const hostileId = 'template/1?x=y#frag';
    const encodedId = encodeURIComponent(hostileId);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/templates' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: hostileId,
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

        if (url === `/api/templates/${encodedId}` && init?.method) {
          return new Response(JSON.stringify({ data: { id: hostileId } }), { status: 200 });
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );

    renderContent();

    const [editButton] = await screen.findAllByRole('button', {
      name: '主治医報告 基本 を編集',
    });
    fireEvent.click(editButton);
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => {
      expect(
        vi
          .mocked(global.fetch)
          .mock.calls.filter(([url]) => String(url) === `/api/templates/${encodedId}`),
      ).toHaveLength(1);
    });

    const mutationCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(([url]) => String(url) === `/api/templates/${encodedId}`) as Array<
      [string, RequestInit]
    >;
    expect(mutationCalls.map(([, init]) => init.method)).toEqual(['PATCH']);
    expect(mutationCalls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'x-test-json-org-id': 'org_1',
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    expect(JSON.parse(String(mutationCalls[0][1].body))).toMatchObject({
      name: '主治医報告 基本',
      template_type: 'care_report',
      target_role: 'physician',
      format: 'html',
      version: 2,
      is_default: true,
    });
    for (const [url, init] of mutationCalls) {
      expect(url).not.toContain('%25');
      expect(String(init.body ?? '')).not.toContain(hostileId);
    }
  });

  it('shows ErrorState (not a false-empty list) with retry when the templates query fails', async () => {
    let templatesCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/templates') && !init?.method) {
          templatesCalls += 1;
          // 取得失敗 → 空一覧ではなく ErrorState + 再読み込み。
          return new Response(JSON.stringify({ message: 'failed' }), { status: 500 });
        }
        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );

    renderContent();

    expect(await screen.findByText('サーバーエラーが発生しました')).toBeTruthy();
    // false-empty（空一覧メッセージ）を出していないこと。
    expect(screen.queryByText('文書テンプレートはまだありません')).toBeNull();

    const callsBeforeRetry = templatesCalls;
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => {
      expect(templatesCalls).toBeGreaterThan(callsBeforeRetry);
    });
  });

  it('uses shared collection paths and org headers for template reads', async () => {
    renderContent();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/templates', {
        headers: { 'x-test-org-id': 'org_1' },
      });
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('creates templates through the shared collection path and JSON org headers', async () => {
    renderContent();

    fireEvent.change(await screen.findByLabelText('テンプレート名'), {
      target: { value: '新規テンプレート' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/templates',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-test-json-org-id': 'org_1' },
        }),
      );
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('blocks invalid JSON template content without mutating', async () => {
    renderContent();

    await screen.findByText('先頭1件を表示 / 他2件');
    vi.mocked(global.fetch).mockClear();

    fireEvent.change(screen.getByLabelText('テンプレート名'), {
      target: { value: '新規テンプレート' },
    });
    const contentField = screen.getByLabelText('テンプレート本文(JSON)');
    fireEvent.change(contentField, { target: { value: '[]' } });

    const saveButton = screen.getByRole('button', { name: '登録する' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe('template-save-blocker');
    expect(contentField.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('template-content-json-error')?.textContent).toBe(
      'テンプレート本文は JSON オブジェクト形式で入力してください',
    );
    expect(document.getElementById('template-save-blocker')?.textContent).toBe(
      'テンプレート本文は JSON オブジェクト形式で入力してください',
    );

    const form = saveButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    const summaryTitle = await screen.findByText('入力内容を確認してください');
    const summary = summaryTitle.closest('[role="alert"]');
    expect(summary?.textContent).toContain('テンプレート本文(JSON)');
    expect(summary?.textContent).toContain(
      'テンプレート本文は JSON オブジェクト形式で入力してください',
    );
    const mutationCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method);
    expect(mutationCalls).toHaveLength(0);
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

  it('orders the page sections テンプレート版管理 → 報告文面を編集 → 送達ルール (info hierarchy)', async () => {
    renderContent();

    // body-editor sentinel は templates query が解決し、親が期待どおりの形で渡したときのみ描画。
    const bodyEditor = await screen.findByTestId('body-editor-sentinel');
    const templateMgmt = screen.getByRole('heading', { level: 2, name: 'テンプレート版管理' });
    const deliverySection = screen.getByRole('heading', { level: 2, name: '送達ルール' });

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    // SSOT 情報順: テンプレート版管理(h2) → 報告文面を編集(body editor) → 送達ルール(h2)。
    expect(templateMgmt.compareDocumentPosition(bodyEditor) & FOLLOWING).toBeTruthy();
    expect(bodyEditor.compareDocumentPosition(deliverySection) & FOLLOWING).toBeTruthy();

    // 内側パネルは CardTitle asChild で実 h3(見出し階層に組み込まれている)。
    expect(screen.getByRole('heading', { level: 3, name: 'テンプレートを登録' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: '登録済みテンプレート' })).toBeTruthy();
  });
});
