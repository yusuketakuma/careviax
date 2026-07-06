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

function makeAuditLogSummary(totalCount: number, highRiskPending = totalCount > 0 ? 1 : 0) {
  return {
    high_risk_unreviewed_count: highRiskPending,
    review_dashboard: {
      scope: 'filtered',
      generated_at: '2026-06-20T02:00:00.000Z',
      total_count: totalCount,
      risk_tier: {
        high: highRiskPending,
        standard: Math.max(totalCount - highRiskPending, 0),
      },
      review_state: {
        pending: highRiskPending,
        reviewed: Math.max(totalCount - highRiskPending, 0),
      },
      high_risk: {
        total: highRiskPending,
        pending_review: highRiskPending,
        reviewed: 0,
      },
      filters: {
        risk_tier: null,
        review_state: null,
        target_type: null,
        action: null,
        date_from: '2026-05-21T00:00:00.000Z',
        date_to: '2026-06-20T23:59:59.999Z',
        actor_used: false,
        actor_pharmacy_used: false,
        actor_site_used: false,
        patient_used: false,
        reviewed_by_used: false,
      },
    },
  };
}

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
      return new Response(JSON.stringify({ data: [], summary: makeAuditLogSummary(0, 0) }), {
        status: 200,
      });
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
    risk_tier: index === 0 ? 'high' : 'standard',
    risk_label: index === 0 ? '高リスク' : '通常',
    redaction_state: index === 0 ? 'redacted' : 'not_applicable',
    review_state: index === 0 ? 'pending' : 'reviewed',
    reviewed_at: index === 0 ? null : '2026-06-20T02:00:00.000Z',
    reviewed_by: index === 0 ? null : 'admin_1',
    reason_code: index === 0 ? null : 'admin_reviewed',
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
        JSON.stringify({
          data: Array.from({ length: count }, (_, i) => makeAuditLog(i)),
          summary: makeAuditLogSummary(count, count > 0 ? 1 : 0),
        }),
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
      '高リスク',
      '通常',
      'レビュー待ち',
      'レビュー済み',
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
    expect(screen.getByRole('button', { name: '検索条件全件CSV出力' }).className).toContain(
      'sm:min-h-[44px]',
    );
    expect(screen.getByPlaceholderText('ユーザーIDで検索').className).toContain('sm:min-h-[44px]');
    expect(screen.getByPlaceholderText('確認者IDで検索').className).toContain('sm:min-h-[44px]');
    expect(document.getElementById('risk-tier-filter')?.className).toContain('sm:min-h-[44px]');
    expect(document.getElementById('review-state-filter')?.className).toContain('sm:min-h-[44px]');
    expect(document.getElementById('target-type-filter')?.className).toContain('sm:min-h-[44px]');
    expect(document.getElementById('action-filter')?.className).toContain('sm:min-h-[44px]');
  });

  it('passes selected risk and consent audit filters to list and export requests', async () => {
    const fetchMock = stubFetch();
    renderContent();

    await screen.findByText('ログがありません');

    fireEvent.click(screen.getByRole('button', { name: '高リスク' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'レビュー待ち' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '同意記録' }));
    fireEvent.click(screen.getByRole('button', { name: '同意記録閲覧' }));
    fireEvent.change(screen.getByPlaceholderText('確認者IDで検索'), {
      target: { value: 'admin_1' },
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const url = String(input);
          if (!url.startsWith('/api/audit-logs?')) return false;
          const params = searchParamsFromUrl(url);
          return (
            params.get('risk_tier') === 'high' &&
            params.get('review_state') === 'pending' &&
            params.get('reviewed_by') === 'admin_1' &&
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
      expect(params.get('risk_tier')).toBe('high');
      expect(params.get('review_state')).toBe('pending');
      expect(params.get('reviewed_by')).toBe('admin_1');
      expect(params.get('target_type')).toBe('consent_record');
      expect(params.get('action')).toBe('consent_record_viewed');
      expect(params.get('format')).toBe('json');
    });
    expect(screen.getByText(/確認者\s*admin_1/)).toBeTruthy();
  });

  it('shows risk and redaction badges returned by the audit API', async () => {
    stubFetchWithLogs(2);
    renderContent();

    expect(await screen.findAllByText('target_0')).not.toHaveLength(0);
    expect(await screen.findAllByText('高リスク')).not.toHaveLength(0);
    expect(screen.getAllByText('本文マスク済').length).toBeGreaterThan(0);
    expect(screen.getByText(/高リスク未レビュー（現在条件内）\s*1件/)).toBeTruthy();
    expect(screen.getAllByText('レビュー済み').length).toBeGreaterThan(0);
    expect(screen.getAllByText('通常').length).toBeGreaterThan(0);
    expect(screen.getAllByText('対象外').length).toBeGreaterThan(0);
    expect(screen.getByTestId('audit-logs-risk-notice').textContent).toContain('risk_tier');
    expect(screen.getByTestId('audit-logs-risk-notice').textContent).toContain('review_state');
  });

  it('marks a pending audit log as reviewed from the table action', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/audit-logs/log_0/review') {
        expect(init).toMatchObject({
          method: 'PATCH',
          headers: expect.objectContaining({
            'x-org-id': 'org_1',
            'content-type': 'application/json',
          }),
          body: JSON.stringify({
            review_state: 'reviewed',
            reason_code: 'expected_access',
          }),
        });
        return new Response(
          JSON.stringify({
            data: {
              audit_log_id: 'log_0',
              review_state: 'reviewed',
            },
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/audit-logs?')) {
        return new Response(
          JSON.stringify({
            data: [makeAuditLog(0)],
            summary: makeAuditLogSummary(1, 1),
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    expect(await screen.findAllByText('target_0')).not.toHaveLength(0);
    const reviewButton = screen.getAllByRole('button', {
      name: /高リスク.*操作者0.*target_0をレビュー済みにする/,
    })[0];
    expect(reviewButton.className).toContain('min-h-[44px]');
    fireEvent.click(reviewButton);

    const dialog = await screen.findByRole('dialog', {
      name: '高リスク監査ログをレビュー済みにする',
    });
    expect(dialog.textContent).toContain('操作者0');
    expect(dialog.textContent).toContain('target_0');
    expect(dialog.textContent).toContain('本文マスク済');
    expect(screen.getByText('業務上想定された操作')).toBeTruthy();
    expect(dialog.textContent).not.toContain('expected_access');
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === '/api/audit-logs/log_0/review'),
    ).toBe(false);
    const confirmButton = screen.getByRole('button', { name: 'レビュー済みにする' });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('レビュー理由'), {
      target: { value: 'expected_access' },
    });
    fireEvent.click(screen.getByLabelText('対象ログを確認しました'));
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('監査ログをレビュー済みにしました');
    });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === '/api/audit-logs/log_0/review'),
    ).toBe(true);
    const reviewCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/audit-logs/log_0/review',
    );
    expect((reviewCall?.[1] as RequestInit | undefined)?.body).toBe(
      JSON.stringify({
        review_state: 'reviewed',
        reason_code: 'expected_access',
      }),
    );
  });

  it('keeps failed audit review updates visible in the row and retries the same log', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/audit-logs/log_1/review') {
        void init;
        return new Response(JSON.stringify({ message: '監査ログレビューを更新できませんでした' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('/api/audit-logs?')) {
        const standardPending = {
          ...makeAuditLog(1),
          review_state: 'pending',
          reviewed_at: null,
          reviewed_by: null,
          reason_code: null,
        };
        return new Response(
          JSON.stringify({
            data: [standardPending],
            summary: makeAuditLogSummary(1, 0),
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    const reviewButton = (
      await screen.findAllByRole('button', {
        name: /通常.*操作者1.*target_1をレビュー済みにする/,
      })
    )[0];
    fireEvent.click(reviewButton);

    const alerts = await screen.findAllByRole('alert');
    expect(
      alerts.some((alert) => alert.textContent?.includes('監査ログレビューを更新できませんでした')),
    ).toBe(true);
    const retryButton = screen.getAllByRole('button', {
      name: /通常.*target_1をレビュー済みにする/,
    })[0];
    expect(retryButton.textContent).toContain('再試行');
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === '/api/audit-logs/log_1/review'),
      ).toHaveLength(2);
    });
  });

  it('uses the server message from a failed audit export response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/audit-logs/export?')) {
        return new Response(JSON.stringify({ message: '監査ログの出力権限がありません' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('/api/audit-logs?')) {
        return new Response(JSON.stringify({ data: [], summary: makeAuditLogSummary(0, 0) }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();
    await screen.findByText('ログがありません');

    fireEvent.click(screen.getByRole('button', { name: 'JSON出力' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('監査ログの出力権限がありません');
    });
  });

  it('uses the audit export fallback toast when a failed audit export response is not JSON', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/audit-logs/export?')) {
        return new Response('not json', { status: 500 });
      }
      if (url.startsWith('/api/audit-logs?')) {
        return new Response(JSON.stringify({ data: [], summary: makeAuditLogSummary(0, 0) }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();
    await screen.findByText('ログがありません');

    fireEvent.click(screen.getByRole('button', { name: '検索条件全件CSV出力' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('監査ログのエクスポートに失敗しました');
    });
  });

  it('routes CSV export through the approved full-scope audit log export surface', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/audit-logs/export?')) {
        return new Response('id,action\nlog_1,export', {
          status: 200,
          headers: {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="audit-logs.csv"',
          },
        });
      }
      if (url.startsWith('/api/audit-logs?')) {
        return new Response(JSON.stringify({ data: [], summary: makeAuditLogSummary(0, 0) }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();
    await screen.findByText('ログがありません');

    const csvButton = screen.getByRole('button', { name: '検索条件全件CSV出力' });
    expect(screen.queryByRole('button', { name: 'CSV出力' })).toBeNull();
    fireEvent.click(csvButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('監査ログをCSV形式で出力しました');
    });
    const exportCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('/api/audit-logs/export?'),
    );
    expect(exportCall).toBeDefined();
    const params = searchParamsFromUrl(String(exportCall?.[0]));
    expect(params.get('format')).toBe('csv');
  });

  it('uses the audit export fallback toast when the thrown error has an empty message', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/audit-logs/export?')) {
        throw new Error('');
      }
      if (url.startsWith('/api/audit-logs?')) {
        return new Response(JSON.stringify({ data: [], summary: makeAuditLogSummary(0, 0) }), {
          status: 200,
        });
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

  it('keeps successful audit export downloads on the blob path without reading JSON text', async () => {
    const exportResponse = new Response(JSON.stringify([]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-disposition': 'attachment; filename="audit-logs.json"',
      },
    });
    const blobSpy = vi.spyOn(exportResponse, 'blob');
    const textSpy = vi.spyOn(exportResponse, 'text');
    const jsonSpy = vi.spyOn(exportResponse, 'json');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/audit-logs/export?')) {
        return exportResponse;
      }
      if (url.startsWith('/api/audit-logs?')) {
        return new Response(JSON.stringify({ data: [], summary: makeAuditLogSummary(0, 0) }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();
    await screen.findByText('ログがありません');

    fireEvent.click(screen.getByRole('button', { name: 'JSON出力' }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('監査ログをJSON形式で出力しました');
    });
    expect(blobSpy).toHaveBeenCalledOnce();
    expect(textSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
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
