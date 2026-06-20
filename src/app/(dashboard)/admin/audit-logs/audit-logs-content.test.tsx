// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { AuditLogsContent } from './audit-logs-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: PropsWithChildren<{ value?: string; onValueChange?: (value: string) => void }>) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children, id }: PropsWithChildren<{ id?: string }>) => (
      <div id={id}>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const context = React.useContext(SelectContext);
      return <span>{context.value || placeholder}</span>;
    },
    SelectContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    SelectItem: ({ value, children }: PropsWithChildren<{ value: string }>) => {
      const context = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

setupDomTestEnv();

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
  return render(<AuditLogsContent />, { wrapper: createWrapper() });
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/audit-logs/export?')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-disposition': 'attachment; filename="audit-logs.json"',
        },
      });
    }
    if (url.startsWith('/api/audit-logs?')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function searchParamsFromUrl(url: string) {
  return new URL(url, 'http://localhost').searchParams;
}

describe('AuditLogsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:audit-logs'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows an error state instead of a false empty when the audit log fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/audit-logs?')) {
          return new Response('error', { status: 500 });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    renderContent();

    // 取得失敗は ErrorState(再試行導線)で示し、「ログがありません」(空)には倒さない
    expect(await screen.findByText('監査ログを取得できませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    expect(screen.queryByText('ログがありません')).toBeNull();
  });

  it('renders audit filters for consent, patient-share, and file-download events', async () => {
    stubFetch();
    renderContent();

    await screen.findByText('ログがありません');

    for (const label of [
      '同意記録',
      '患者共有ケース',
      '患者共有同意',
      '患者共有同意DB',
      '患者リンク',
      '共有情報訂正依頼',
      'ファイル',
      '報告書',
      '同意記録閲覧',
      '患者共有同意一覧閲覧',
      '患者リンク受諾',
      'ファイルダウンロード',
      '報告書印刷要求',
    ]) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    }
  });

  it('passes selected consent audit filters to list and export requests', async () => {
    const fetchMock = stubFetch();
    renderContent();

    await screen.findByText('ログがありません');

    fireEvent.click(screen.getByRole('button', { name: '同意記録' }));
    fireEvent.click(screen.getByRole('button', { name: '同意記録閲覧' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = String(input);
          if (!url.startsWith('/api/audit-logs?')) return false;
          const params = searchParamsFromUrl(url);
          return (
            params.get('target_type') === 'consent_record' &&
            params.get('action') === 'consent_record_viewed'
          );
        }),
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'JSON出力' }));

    await waitFor(() => {
      const exportCall = fetchMock.mock.calls.find(([input]) =>
        String(input).startsWith('/api/audit-logs/export?'),
      );
      expect(exportCall).toBeDefined();
      const params = searchParamsFromUrl(String(exportCall?.[0]));
      expect(params.get('target_type')).toBe('consent_record');
      expect(params.get('action')).toBe('consent_record_viewed');
      expect(params.get('format')).toBe('json');
    });
  });
});
