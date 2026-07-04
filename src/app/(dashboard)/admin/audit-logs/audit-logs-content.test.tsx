// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
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

import { toast } from 'sonner';

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
    SelectTrigger: ({
      children,
      id,
      className,
    }: PropsWithChildren<{ id?: string; className?: string }>) => (
      <div id={id} className={className}>
        {children}
      </div>
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

function renderContent() {
  return render(<AuditLogsContent />, { wrapper: createQueryClientWrapper() });
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
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

function makeAuditLog(index: number) {
  return {
    id: `log_${index}`,
    actor_id: `user_${index}`,
    actor_name: `操作者${index}`,
    action: 'create',
    target_type: 'patient',
    target_id: `target_${index}`,
    ip_address: null,
    created_at: '2026-06-20T01:00:00.000Z',
  };
}

function stubFetchWithLogs(count: number) {
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
      return new Response(
        JSON.stringify({ data: Array.from({ length: count }, (_, i) => makeAuditLog(i)) }),
        { status: 200 },
      );
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
    const fetchMock = stubFetch();
    renderContent();

    await screen.findByText('ログがありません');
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        return (
          String(input).startsWith('/api/audit-logs?') &&
          (init as RequestInit | undefined)?.headers === undefined
        );
      }),
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/audit-logs\?/),
      expect.objectContaining({ headers: { 'x-org-id': 'org_1' } }),
    );

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

  it('prioritizes the audit list before detailed display filters and keeps primary controls at page-body target size', async () => {
    stubFetch();
    renderContent();

    await screen.findByText('ログがありません');

    const listTitle = screen.getByText('監査ログ一覧');
    const filterTitle = screen.getByText('表示条件を変更');
    expect(
      listTitle.compareDocumentPosition(filterTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(filterTitle.closest('summary')?.className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', { name: 'JSON出力' }).className).toContain('sm:min-h-[44px]');
    expect(screen.getByRole('button', { name: 'CSV出力' }).className).toContain('sm:min-h-[44px]');
    expect(screen.getByPlaceholderText('ユーザーIDで検索').className).toContain('sm:min-h-[44px]');
    expect(document.getElementById('target-type-filter')?.className).toContain('sm:min-h-[44px]');
    expect(document.getElementById('action-filter')?.className).toContain('sm:min-h-[44px]');
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

  it('uses the audit export fallback toast when the thrown error has an empty message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/audit-logs/export?')) {
        throw new Error('');
      }
      if (url.startsWith('/api/audit-logs?')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();
    await screen.findByText('ログがありません');

    fireEvent.click(screen.getByRole('button', { name: 'JSON出力' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('監査ログのエクスポートに失敗しました');
    });
  });

  it('requests the audit log list with the 100-row display limit', async () => {
    const fetchMock = stubFetchWithLogs(3);
    renderContent();

    await waitFor(() => {
      const listCall = fetchMock.mock.calls.find(([input]) =>
        String(input).startsWith('/api/audit-logs?'),
      );
      expect(listCall).toBeTruthy();
      expect(searchParamsFromUrl(String(listCall?.[0])).get('limit')).toBe('100');
    });
  });

  it('shows the actual count and no cap notice when under the display limit', async () => {
    stubFetchWithLogs(3);
    renderContent();

    expect(await screen.findByText(/表示件数\s*3件/)).toBeTruthy();
    expect(screen.queryByTestId('audit-logs-cap-notice')).toBeNull();
  });

  it('flags the list as capped (直近100件) with a non-asserting notice when the limit is reached', async () => {
    stubFetchWithLogs(100);
    renderContent();

    const notice = await screen.findByTestId('audit-logs-cap-notice');
    expect(screen.getByText(/直近100件（表示上限）/)).toBeTruthy();
    // 切り捨ては仕様明示であって「全件」を断定しない(export にも上限がある)。
    expect(notice.textContent).toContain('直近100件まで');
    expect(notice.textContent).toContain('CSV');
    expect(notice.textContent).not.toContain('全件');
  });
});
