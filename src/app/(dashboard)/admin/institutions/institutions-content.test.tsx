// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MemberRole } from '@prisma/client';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { formatDateKey } from '@/lib/date-key';
import { buildPrescriberInstitutionApiPath } from '@/lib/prescriber-institutions/api-paths';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

type MockAuthState = {
  currentUser: { role: MemberRole | null };
};

const useAuthStoreMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stores/auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

/** 既定は admin(編集/削除/新規登録ボタンが見えるロール)。非管理者テストは個別に上書きする。 */
function mockViewerRole(role: MemberRole | null = 'admin') {
  useAuthStoreMock.mockImplementation((selector: (state: MockAuthState) => unknown) =>
    selector({ currentUser: { role } }),
  );
}

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// org-header builders are mocked with SENTINEL returns ('x-test-helper') so the
// tests prove the component DELEGATES to them. A raw inline `{ 'x-org-id': orgId }`
// literal would not carry the sentinel. The prescriber-institution API path helper
// is mocked with its real implementation so tests can assert callsite delegation
// while retaining hostile-encode and dot fail-fast teeth.
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

vi.mock('@/lib/prescriber-institutions/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/prescriber-institutions/api-paths')>();
  return {
    ...actual,
    buildPrescriberInstitutionApiPath: vi.fn(actual.buildPrescriberInstitutionApiPath),
  };
});

vi.mock('@/components/ui/data-table', async () => {
  const { useState } = await import('react');
  return {
    DataTable: ({
      columns,
      data,
      errorMessage,
      onRetry,
      enablePagination,
      pageSize,
    }: {
      columns: Array<{
        id?: string;
        accessorKey?: string;
        cell?: (args: { row: { original: unknown } }) => ReactNode;
      }>;
      data: unknown[];
      errorMessage?: string;
      onRetry?: () => void;
      enablePagination?: boolean;
      pageSize?: number;
    }) => {
      // enablePagination 時のみ pageSize でクライアントページングする簡易モック
      // (実装の DataTable 内部挙動は data-table.test.tsx が担保する)。
      const [pageIndex, setPageIndex] = useState(0);
      const size = enablePagination ? (pageSize ?? data.length) : data.length;
      const pageCount = enablePagination ? Math.max(1, Math.ceil(data.length / size)) : 1;
      const visible = enablePagination
        ? data.slice(pageIndex * size, pageIndex * size + size)
        : data;

      return (
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
          {visible.map((row, rowIndex) => (
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
          {enablePagination ? (
            <div>
              <span>
                {pageIndex + 1}/{pageCount}ページ
              </span>
              <button
                type="button"
                onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                disabled={pageIndex === 0}
              >
                前のページ
              </button>
              <button
                type="button"
                onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                disabled={pageIndex >= pageCount - 1}
              >
                次のページ
              </button>
            </div>
          ) : null}
        </div>
      );
    },
  };
});

import {
  InstitutionsContent,
  isInstitutionPrescriptionStale,
  type Institution,
} from './institutions-content';

function renderContent() {
  return render(<InstitutionsContent />, { wrapper: createQueryClientWrapper() });
}

function institutionFixture(id = 'institution_1'): Institution {
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

    if (url.startsWith('/api/prescriber-institutions?') && !init?.method) {
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
    mockViewerRole('admin');
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

  it('keeps list actions and search at medical touch target size', async () => {
    renderContent();

    const actionNames = ['新規登録', '在宅内科クリニック を編集', '在宅内科クリニック を削除'];

    for (const name of actionNames) {
      const control = await screen.findByRole('button', { name });
      expect(control.className).toContain('!h-11');
      expect(control.className).toContain('!min-h-[44px]');
    }

    expect(screen.getByLabelText('検索').className).toContain('!h-11');
    expect(screen.getByLabelText('検索').className).toContain('!min-h-[44px]');
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
    expect(JSON.parse(init.body as string)).toEqual({
      name: '連携クリニック',
      institution_code: '',
      address: '',
      phone: '',
      fax: '',
      notes: '',
    });
  });

  it('surfaces API error messages when institution save fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/prescriber-institutions?') && !init?.method) {
        return new Response(JSON.stringify({ data: [institutionFixture()] }), { status: 200 });
      }
      if (url === '/api/prescriber-institutions' && init?.method === 'POST') {
        return new Response(JSON.stringify({ message: '医療機関コードが重複しています' }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    await screen.findByRole('button', { name: '在宅内科クリニック を編集' });
    fireEvent.click(screen.getByRole('button', { name: '新規登録' }));
    fireEvent.change(screen.getByLabelText('医療機関名'), {
      target: { value: '連携クリニック' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('医療機関コードが重複しています');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/prescriber-institutions',
      expect.objectContaining({
        method: 'POST',
        headers: buildOrgJsonHeaders('org_1'),
      }),
    );
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
    expect(buildPrescriberInstitutionApiPath).toHaveBeenCalledWith('a/b c');
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/prescriber-institutions/a%2Fb%20c' &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    );
    const init = patchCall![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      name: '在宅内科クリニック',
      institution_code: '1312345678',
      address: '東京都千代田区1-1',
      phone: '03-1111-2222',
      fax: '03-1111-2223',
      notes: '報告書はFAX優先',
    });
  });

  it('update (PATCH) with a dot-segment institution id fails closed before any PATCH fetch', async () => {
    const fetchMock = stubFetchWithInstitution(institutionFixture('.'));
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '在宅内科クリニック を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildPrescriberInstitutionApiPath).toHaveBeenCalledWith('.');
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
    expect(buildPrescriberInstitutionApiPath).toHaveBeenCalledWith('a/b c');
  });

  it('surfaces API error messages when institution delete fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/prescriber-institutions?') && !init?.method) {
        return new Response(JSON.stringify({ data: [institutionFixture()] }), { status: 200 });
      }
      if (url === '/api/prescriber-institutions/institution_1' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ message: '処方実績がある医療機関は削除できません' }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '在宅内科クリニック を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('処方実績がある医療機関は削除できません');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/prescriber-institutions/institution_1',
      expect.objectContaining({
        method: 'DELETE',
        headers: buildOrgHeaders('org_1'),
      }),
    );
  });

  it('DELETE with a dot-segment institution id fails closed before any DELETE fetch', async () => {
    const fetchMock = stubFetchWithInstitution(institutionFixture('.'));
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '在宅内科クリニック を削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(buildPrescriberInstitutionApiPath).toHaveBeenCalledWith('.');
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

  it('debounces the search so it requests only after the user pauses typing', async () => {
    const fetchMock = stubFetchWithInstitution();
    renderContent();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/prescriber-institutions?', expect.anything()),
    );

    fireEvent.change(screen.getByLabelText('検索'), { target: { value: '在宅' } });
    // 入力値は即時反映する。
    expect((screen.getByLabelText('検索') as HTMLInputElement).value).toBe('在宅');
    // 打鍵直後には q= 付き fetch は走らない(debounce)。
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('q='))).toBe(false);

    // 300ms 経過後に q= 付きで fetch される。
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('q='))).toBe(true),
    );
  });

  it('treats prescriptions older than 180 days as stale and null/invalid dates as fresh', () => {
    const now = new Date('2026-06-27T00:00:00+09:00');
    expect(isInstitutionPrescriptionStale('2025-01-01', now)).toBe(true);
    expect(isInstitutionPrescriptionStale('2026-06-01', now)).toBe(false);
    expect(isInstitutionPrescriptionStale(null, now)).toBe(false);
    expect(isInstitutionPrescriptionStale('not-a-date', now)).toBe(false);
  });

  it('shows a confirm freshness badge for a stale institution row', async () => {
    stubFetchWithInstitution({ ...institutionFixture(), last_prescribed_at: '2025-01-01' });
    renderContent();

    const badge = await screen.findByText('6ヶ月以上前');
    expect(badge.closest('[data-role]')?.getAttribute('data-role')).toBe('confirm');
  });

  it('shows a neutral 処方なし label when an institution has no prescriptions', async () => {
    stubFetchWithInstitution({
      ...institutionFixture(),
      last_prescribed_at: null,
      prescription_count: 0,
    });
    renderContent();

    expect(await screen.findByText('処方なし')).toBeTruthy();
    expect(screen.queryByText('6ヶ月以上前')).toBeNull();
  });

  it('does not flag a recently prescribing institution', async () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 10);
    const recentDate = formatDateKey(recent);
    stubFetchWithInstitution({ ...institutionFixture(), last_prescribed_at: recentDate });
    renderContent();

    await screen.findByRole('button', { name: '在宅内科クリニック を編集' });
    expect(screen.queryByText('6ヶ月以上前')).toBeNull();
    expect(screen.queryByText('処方なし')).toBeNull();
  });

  it('copies the phone number to the clipboard and toasts success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    stubFetchWithInstitution();
    renderContent();

    fireEvent.click(await screen.findByRole('button', { name: '電話番号をコピー' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('03-1111-2222'));
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('電話番号をコピーしました');
  });

  it('omits the copy button when a contact value is missing', async () => {
    stubFetchWithInstitution({ ...institutionFixture(), phone: null });
    renderContent();

    await screen.findByRole('button', { name: '在宅内科クリニック を編集' });
    expect(screen.getByText('TEL未設定')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '電話番号をコピー' })).toBeNull();
    // FAX は値ありなのでコピーボタンは残る。
    expect(screen.getByRole('button', { name: 'FAXをコピー' })).toBeTruthy();
  });

  describe('role-gated actions (canAdmin)', () => {
    it('hides 新規登録/編集/削除 for a non-admin role that would always get 403 from the API', async () => {
      mockViewerRole('pharmacist');
      renderContent();

      // 一覧行が描画されるまで待つ(名前で判定できる要素が出るまで)。
      await screen.findByText('在宅内科クリニック');
      expect(screen.queryByRole('button', { name: '新規登録' })).toBeNull();
      expect(screen.queryByRole('button', { name: '在宅内科クリニック を編集' })).toBeNull();
      expect(screen.queryByRole('button', { name: '在宅内科クリニック を削除' })).toBeNull();
    });

    it('hides admin actions for clerk too', async () => {
      mockViewerRole('clerk');
      renderContent();

      await screen.findByText('在宅内科クリニック');
      expect(screen.queryByRole('button', { name: '新規登録' })).toBeNull();
      expect(screen.queryByRole('button', { name: '在宅内科クリニック を編集' })).toBeNull();
    });

    it('shows admin actions for owner as well as admin', async () => {
      mockViewerRole('owner');
      renderContent();

      expect(await screen.findByRole('button', { name: '新規登録' })).toBeTruthy();
      expect(await screen.findByRole('button', { name: '在宅内科クリニック を編集' })).toBeTruthy();
    });

    it('fails closed (hides admin actions) when role is not yet known', async () => {
      mockViewerRole(null);
      renderContent();

      await screen.findByText('在宅内科クリニック');
      expect(screen.queryByRole('button', { name: '新規登録' })).toBeNull();
      expect(screen.queryByRole('button', { name: '在宅内科クリニック を編集' })).toBeNull();
    });
  });

  it('paginates the institution table at 50 rows/page (W2-F2) so a 51-row result set needs a 2nd page', async () => {
    const manyInstitutions = Array.from({ length: 51 }, (_, index) =>
      institutionFixture(`institution_${index + 1}`),
    ).map((institution, index) => ({ ...institution, name: `医療機関${index + 1}` }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/prescriber-institutions?')) {
          return new Response(JSON.stringify({ data: manyInstitutions }), { status: 200 });
        }
        return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
      }),
    );

    renderContent();

    expect(await screen.findByText('1/2ページ')).toBeTruthy();
    expect(await screen.findByText('医療機関50')).toBeTruthy();
    expect(screen.queryByText('医療機関51')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '次のページ' }));

    expect(await screen.findByText('2/2ページ')).toBeTruthy();
    expect(await screen.findByText('医療機関51')).toBeTruthy();
  });
});
