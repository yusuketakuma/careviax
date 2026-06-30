// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildDrugAlertRuleApiPath } from '@/lib/drug-alert-rules/api-paths';
import AlertRulesPage from './page';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

// org-header builders are mocked with SENTINEL returns ('x-test-helper') so the
// tests prove the page DELEGATES to them: a raw inline { 'x-org-id': orgId } literal
// lacks the sentinel, so a deep-equal on the sentinel object fails for un-converged
// code. The alert-rule API path helper is mocked with its real implementation so
// tests can assert callsite delegation while retaining hostile-encode and dot
// fail-fast teeth.
const buildOrgHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({ 'x-org-id': orgId, 'x-test-helper': 'orgHeaders' })),
);
const buildOrgJsonHeadersMock = vi.hoisted(() =>
  vi.fn((orgId: string) => ({
    'Content-Type': 'application/json',
    'x-org-id': orgId,
    'x-test-helper': 'orgJsonHeaders',
  })),
);
vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

vi.mock('@/lib/drug-alert-rules/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/drug-alert-rules/api-paths')>();
  return {
    ...actual,
    buildDrugAlertRuleApiPath: vi.fn(actual.buildDrugAlertRuleApiPath),
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('./signal-tuning-panel', () => ({
  SignalTuningPanel: () => <div data-testid="signal-tuning-panel" />,
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
  return render(<AlertRulesPage />, { wrapper: createWrapper() });
}

describe('AlertRulesPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api/drug-alert-rules' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'rule_1',
                  org_id: 'org_1',
                  alert_type: 'interaction',
                  condition: { severity: 'high' },
                  severity: 'warning',
                  message: '併用禁忌候補を再確認してください',
                  is_active: true,
                  updated_at: '2026-06-19T10:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/drug-alert-rules/rule_1' && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ message: '処方安全アラートルールを削除しました' }), {
            status: 200,
          });
        }

        if (url === '/api/drug-alert-rules' && init?.method === 'POST') {
          return new Response(JSON.stringify({ data: { id: 'rule_new' } }), { status: 200 });
        }

        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires confirmation before deleting an alert rule', async () => {
    renderPage();

    expect(await screen.findByText('登録済みルール')).toBeTruthy();
    expect(screen.queryByText('最初に見るポイント')).toBeNull();
    expect(
      screen.getByText('登録済みルール').compareDocumentPosition(screen.getByText('ルールを登録')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(
      await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' }),
    );

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/drug-alert-rules/rule_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(
      screen.getByRole('alertdialog', { name: '処方安全アラートルールを削除しますか' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        '相互作用（注意）の組織ルールを削除します。この操作は取り消せません。処方安全チェックの表示に反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/drug-alert-rules/rule_1',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('names the edit action and loads the selected alert rule into the form', async () => {
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを編集' }),
    );

    expect(screen.getByRole('button', { name: '更新する' })).toBeTruthy();
    expect((screen.getByLabelText('表示メッセージ') as HTMLInputElement).value).toBe(
      '併用禁忌候補を再確認してください',
    );
    expect((screen.getByLabelText('条件(JSON)') as HTMLTextAreaElement).value).toContain(
      '"severity": "high"',
    );
  });

  it('shows ErrorState (not a false-empty) with retry when the rules query fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    renderPage();

    // 取得失敗 → 空状態ではなく ErrorState（サーバーエラー）+ 再読み込み。
    expect(await screen.findByText('サーバーエラーが発生しました')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    // false-empty（「まだ…ありません」）を出していないこと。
    expect(screen.queryByText('まだ処方安全アラートルールはありません。')).toBeNull();
  });

  it('retry re-runs the rules query (calls fetch again)', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await screen.findByText('サーバーエラーが発生しました');
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('shows true-empty only when no rules are returned (and no error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    renderPage();

    expect(await screen.findByText('まだ処方安全アラートルールはありません。')).toBeTruthy();
    expect(screen.queryByText('サーバーエラーが発生しました')).toBeNull();
  });

  it('shows hidden alert rule counts when the API result is truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/drug-alert-rules' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'rule_1',
                  org_id: 'org_1',
                  alert_type: 'interaction',
                  condition: {},
                  severity: 'warning',
                  message: '併用禁忌候補を再確認してください',
                  is_active: true,
                  updated_at: '2026-06-19T10:00:00.000Z',
                },
              ],
              total_count: 3,
              visible_count: 1,
              hidden_count: 2,
              truncated: true,
              count_basis: 'drug_alert_rules',
              filters_applied: { alert_type: null },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );

    renderPage();

    expect(await screen.findByText('先頭1件を表示 / 他2件')).toBeTruthy();
    expect(
      screen.getByText(
        '処方安全アラートルールは先頭1件のみ表示中です。他2件はアラート種別で絞り込むか limit を上げて確認してください。',
      ),
    ).toBeTruthy();
  });

  it('persists the chosen alert type and severity into the save payload', async () => {
    renderPage();

    await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' });

    const alertType = screen.getByLabelText('アラート種別') as HTMLSelectElement;
    const severity = screen.getByLabelText('重要度') as HTMLSelectElement;

    // 既定（種別=相互作用 / 重要度=warning）から別の医薬安全値へ変更できる。
    fireEvent.change(alertType, { target: { value: 'narcotic' } });
    fireEvent.change(severity, { target: { value: 'critical' } });

    expect((screen.getByLabelText('アラート種別') as HTMLSelectElement).value).toBe('narcotic');
    expect((screen.getByLabelText('重要度') as HTMLSelectElement).value).toBe('critical');

    // DOM 値だけでなく、実際に保存される POST payload まで反映されることを確認する。
    // 処方安全ルールの種別・重要度は臨床的に重要なため、UI 変更が既定値で保存される退行を防ぐ。
    fireEvent.change(screen.getByLabelText('表示メッセージ'), {
      target: { value: '麻薬の重複投与を確認してください' },
    });
    fireEvent.change(screen.getByLabelText('条件(JSON)'), {
      target: { value: '{"threshold":"high"}' },
    });

    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    const fetchMock = vi.mocked(global.fetch);
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === '/api/drug-alert-rules' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });

    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/drug-alert-rules' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      alert_type: 'narcotic',
      severity: 'critical',
      is_active: true,
      message: '麻薬の重複投与を確認してください',
      condition: { threshold: 'high' },
    });
  });

  it('gives the alert-type and severity selects a >=44px touch target at all breakpoints (WCAG)', async () => {
    renderPage();

    await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' });
    const workspaceClassName = screen.getByTestId('alert-rules-workspace').className;
    expect(workspaceClassName).toContain('[&_button]:!min-h-[44px]');
    expect(workspaceClassName).toContain('[&_input]:!min-h-[44px]');
    expect(screen.getByRole('switch', { name: '有効化' }).className).toContain('!h-11');

    // 共有 SelectTrigger の既定は sm で min-h-0/h-8 へ縮むため、ページ側の sm:min-h-[44px]
    // 上書きまで assert し、将来このデスクトップ 44px 契約が落ちる退行を捕捉する。
    for (const label of ['アラート種別', '重要度']) {
      const className = screen.getByLabelText(label).className;
      expect(className).toContain('min-h-[44px]');
      expect(className).toContain('sm:min-h-[44px]');
    }
  });

  it('GET rules delegates to buildOrgHeaders(orgId) instead of a raw x-org-id literal', async () => {
    renderPage();
    await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' });

    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(global.fetch).toHaveBeenCalledWith('/api/drug-alert-rules', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('create (POST) delegates to buildOrgJsonHeaders(orgId)', async () => {
    renderPage();
    await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' });

    fireEvent.change(screen.getByLabelText('表示メッセージ'), {
      target: { value: 'テストメッセージ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    const fetchMock = vi.mocked(global.fetch);
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === '/api/drug-alert-rules' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/drug-alert-rules' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect((postCall![1] as RequestInit).headers).toEqual(buildOrgJsonHeaders('org_1'));
  });

  it('DELETE encodes a hostile rule id via encodePathSegment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/drug-alert-rules' && !init?.method) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'a/b c',
                  org_id: 'org_1',
                  alert_type: 'interaction',
                  condition: {},
                  severity: 'warning',
                  message: 'm',
                  is_active: true,
                  updated_at: '2026-06-19T10:00:00.000Z',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({}), { status: 200 });
      }),
    );
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/drug-alert-rules/a%2Fb%20c',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
    expect(buildDrugAlertRuleApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('DELETE with a dot-segment rule id fails closed before any DELETE fetch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/drug-alert-rules' && !init?.method) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: '.',
                org_id: 'org_1',
                alert_type: 'interaction',
                condition: {},
                severity: 'warning',
                message: 'm',
                is_active: true,
                updated_at: '2026-06-19T10:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(toast.error).mockClear();
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    // the dot id throws inside the mutationFn path helper before fetch, so
    // onError fires and NO DELETE request is ever issued.
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildDrugAlertRuleApiPath).toHaveBeenCalledWith('.');
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  function stubFetchWithRule(ruleId: string) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/drug-alert-rules' && !init?.method) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: ruleId,
                org_id: 'org_1',
                alert_type: 'interaction',
                condition: { severity: 'high' },
                severity: 'warning',
                message: '併用禁忌候補を再確認してください',
                is_active: true,
                updated_at: '2026-06-19T10:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ alerts: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('update (PATCH) encodes a hostile rule id via encodePathSegment and uses buildOrgJsonHeaders', async () => {
    const fetchMock = stubFetchWithRule('a/b c');
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを編集' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/drug-alert-rules/a%2Fb%20c',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    expect(buildDrugAlertRuleApiPath).toHaveBeenCalledWith('a/b c');
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('update (PATCH) with a dot-segment rule id fails closed before any PATCH fetch', async () => {
    const fetchMock = stubFetchWithRule('.');
    vi.mocked(toast.error).mockClear();
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを編集' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildDrugAlertRuleApiPath).toHaveBeenCalledWith('.');
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('test run (POST /api/cds/check) uses buildOrgJsonHeaders and preserves the cycle id body', async () => {
    const fetchMock = stubFetchWithRule('rule_1');
    renderPage();

    await screen.findByRole('button', { name: '相互作用 の処方安全アラートルールを削除' });
    fireEvent.change(screen.getByLabelText('サイクル ID'), { target: { value: 'cycle_42' } });
    fireEvent.click(screen.getByRole('button', { name: 'テスト実行' }));

    await waitFor(() => {
      const checkCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/cds/check');
      expect(checkCall).toBeTruthy();
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const checkCall = fetchMock.mock.calls.find(([input]) => String(input) === '/api/cds/check');
    const init = checkCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toEqual({ cycleId: 'cycle_42' });
  });
});
