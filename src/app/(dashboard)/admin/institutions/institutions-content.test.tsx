// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';

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

// org-header builders are mocked with SENTINEL returns ('x-test-helper') so the
// tests prove the component DELEGATES to them. A raw inline `{ 'x-org-id': orgId }`
// literal would not carry the sentinel. '@/lib/http/path-segment' is intentionally
// NOT mocked, so hostile-id encode and dot fail-fast teeth exercise the real util.
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

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
    errorMessage,
    onRetry,
  }: {
    columns: Array<{
      id?: string;
      accessorKey?: string;
      cell?: (args: { row: { original: unknown } }) => ReactNode;
    }>;
    data: unknown[];
    errorMessage?: string;
    onRetry?: () => void;
  }) => (
    <div>
      {errorMessage ? (
        <div role="alert">
          <p>{errorMessage}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              再読み込み
            </button>
          ) : null}
        </div>
      ) : null}
      {data.map((row, rowIndex) => (
        <div key={rowIndex}>
          {columns.map((column, columnIndex) =>
            column.cell ? (
              <div key={`${column.id ?? column.accessorKey ?? columnIndex}`}>
                {column.cell({ row: { original: row } })}
              </div>
            ) : null,
          )}
        </div>
      ))}
    </div>
  ),
}));

import { InstitutionsContent } from './institutions-content';

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
  return render(<InstitutionsContent />, { wrapper: createWrapper() });
}

function institutionFixture(id = 'institution_1') {
  return {
    id,
    name: '在宅内科クリニック',
    institution_code: '1312345678',
    address: '東京都千代田区1-1',
    phone: '03-1111-2222',
    fax: '03-1111-2223',
    notes: '報告書はFAX優先',
    prescription_count: 12,
    last_prescribed_at: '2026-06-01',
  };
}

function stubFetchWithInstitution(institution = institutionFixture()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === '/api/prescriber-institutions?' && !init?.method) {
      return new Response(JSON.stringify({ data: [institution] }), { status: 200 });
    }

    if (url === '/api/prescriber-institutions' && init?.method === 'POST') {
      return new Response(JSON.stringify({ message: '医療機関を登録しました' }), { status: 200 });
    }

    if (url.startsWith('/api/prescriber-institutions/') && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ message: '医療機関マスターを更新しました' }), {
        status: 200,
      });
    }

    if (url.startsWith('/api/prescriber-institutions/') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ message: '医療機関マスターを削除しました' }), {
        status: 200,
      });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('InstitutionsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubFetchWithInstitution();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET institutions delegates to buildOrgHeaders(orgId) instead of a raw x-org-id literal', async () => {
    const fetchMock = stubFetchWithInstitution();
    renderContent();

    await waitFor(() => expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1'));
    expect(fetchMock).toHaveBeenCalledWith('/api/prescriber-institutions?', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('names institution row actions by target and confirms deletion first', async () => {
    renderContent();

    expect(await screen.findByRole('button', { name: '在宅内科クリニック を編集' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '在宅内科クリニック を削除' }));

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/prescriber-institutions/institution_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('alertdialog', { name: '医療機関を削除しますか？' })).toBeTruthy();
    expect(
      screen.getByText('在宅内科クリニック を削除します。この操作は取り消せません。'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/prescriber-institutions/institution_1',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('create (POST) delegates to buildOrgJsonHeaders and preserves the form body', async () => {
    const fetchMock = stubFetchWithInstitution();
    renderContent();

    await screen.findByRole('button', { name: '在宅内科クリニック を編集' });
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('医療機関名'), {
      target: { value: '連携クリニック' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === '/api/prescriber-institutions' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/prescriber-institutions' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    const init = postCall![1] as RequestInit;
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toMatchObject({ name: '連携クリニック' });
  });

  it('update (PATCH) encodes a hostile institution id via encodePathSegment and uses buildOrgJsonHeaders', async () => {
    const fetchMock = stubFetchWithInstitution(institutionFixture('a/b c'));
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '在宅内科クリニック を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/prescriber-institutions/a%2Fb%20c',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('update (PATCH) with a dot-segment institution id fails closed before any PATCH fetch', async () => {
    const fetchMock = stubFetchWithInstitution(institutionFixture('.'));
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '在宅内科クリニック を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('DELETE encodes a hostile institution id via encodePathSegment', async () => {
    const fetchMock = stubFetchWithInstitution(institutionFixture('a/b c'));
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '在宅内科クリニック を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/prescriber-institutions/a%2Fb%20c',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
  });

  it('DELETE with a dot-segment institution id fails closed before any DELETE fetch', async () => {
    const fetchMock = stubFetchWithInstitution(institutionFixture('.'));
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '在宅内科クリニック を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('passes query failures to DataTable instead of showing a false empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/prescriber-institutions?') {
          return new Response(JSON.stringify({ message: 'internal details' }), { status: 500 });
        }
        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );

    renderContent();

    expect((await screen.findByRole('alert')).textContent).toContain(
      '医療機関一覧を取得できませんでした',
    );
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
  });
});
