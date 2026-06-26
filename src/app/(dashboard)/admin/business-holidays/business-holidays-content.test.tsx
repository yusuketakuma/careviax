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

import { BusinessHolidaysContent } from './business-holidays-content';

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
  return render(<BusinessHolidaysContent />, { wrapper: createWrapper() });
}

function holidayFixture(id = 'holiday_1') {
  return {
    id,
    org_id: 'org_1',
    site_id: 'site_1',
    date: '2026-01-01',
    name: '年始休業',
    holiday_type: 'site_closure',
    is_closed: true,
    site: { id: 'site_1', name: '本店' },
  };
}

function stubFetchWithHoliday(holiday = holidayFixture()) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === '/api/pharmacy-sites') {
      return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
        status: 200,
      });
    }

    if (url.startsWith('/api/business-holidays?')) {
      return new Response(JSON.stringify({ data: [holiday] }), { status: 200 });
    }

    if (url === '/api/business-holidays' && init?.method === 'POST') {
      return new Response(JSON.stringify({ message: '休日を登録しました' }), { status: 200 });
    }

    if (url.startsWith('/api/business-holidays/') && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ message: '休日を更新しました' }), { status: 200 });
    }

    if (url.startsWith('/api/business-holidays/') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ message: '休日を削除しました' }), { status: 200 });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('BusinessHolidaysContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubFetchWithHoliday();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET queries delegate to buildOrgHeaders(orgId)', async () => {
    const fetchMock = stubFetchWithHoliday();
    renderContent();

    await screen.findByLabelText('店舗フィルタ');
    const holidaysGetCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('/api/business-holidays?'),
    );

    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacy-sites', {
      headers: buildOrgHeaders('org_1'),
    });
    expect((holidaysGetCall?.[1] as RequestInit | undefined)?.headers).toEqual(
      buildOrgHeaders('org_1'),
    );
  });

  it('requires confirmation before deleting a business holiday', async () => {
    renderContent();

    expect(await screen.findByLabelText('店舗フィルタ')).toBeTruthy();
    expect(screen.getByRole('button', { name: '前月を表示' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '翌月を表示' })).toBeTruthy();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を編集',
      }),
    );

    expect(screen.getByText('休日を編集')).toBeTruthy();
    expect((screen.getByLabelText('休日名') as HTMLInputElement).value).toBe('年始休業');

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を削除',
      }),
    );

    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/business-holidays/holiday_1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByRole('alertdialog', { name: '休日設定を削除しますか' })).toBeTruthy();
    expect(
      screen.getByText(
        '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を削除します。この操作は取り消せません。シフト表と訪問可能日の表示にも反映されます。',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/business-holidays/holiday_1',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('places the calendar workspace before summary cards and keeps desktop controls at page-body target size', async () => {
    renderContent();

    await screen.findByLabelText('店舗フィルタ');

    const monthTitle = screen.getByText(/年\d+月/);
    const summaryTitle = screen.getByText('今月の休日数');
    expect(
      monthTitle.compareDocumentPosition(summaryTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '前月を表示' }).className).toContain('sm:size-11');
    expect(screen.getByLabelText('店舗フィルタ').className).toContain('sm:min-h-[44px]');
    expect(screen.getByRole('button', { name: '一括登録' }).className).toContain('sm:min-h-[44px]');
    await screen.findByText('年始休業');
    expect(
      screen.getByRole('button', {
        name: '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を編集',
      }).className,
    ).toContain('sm:min-h-[44px]');
  });

  it('create (POST) delegates to buildOrgJsonHeaders and posts to the static collection path', async () => {
    const fetchMock = stubFetchWithHoliday();
    renderContent();

    await screen.findByLabelText('店舗フィルタ');
    fireEvent.click(await screen.findByLabelText('1日'));
    fireEvent.change(screen.getByLabelText('休日名'), { target: { value: '臨時休業' } });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === '/api/business-holidays' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/business-holidays' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    const init = postCall![1] as RequestInit;
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: '臨時休業',
      holiday_type: 'site_closure',
      is_closed: true,
    });
  });

  it('bulk create (POST) delegates to buildOrgJsonHeaders and preserves each selected date body', async () => {
    const fetchMock = stubFetchWithHoliday();
    renderContent();

    await screen.findByLabelText('店舗フィルタ');
    fireEvent.click(screen.getByRole('button', { name: '一括登録' }));
    fireEvent.click(await screen.findByLabelText('1日'));
    fireEvent.change(screen.getByLabelText('休日名'), { target: { value: '棚卸休業' } });
    fireEvent.click(screen.getByRole('button', { name: '1件を一括登録' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === '/api/business-holidays' &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/business-holidays' &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    const init = postCall![1] as RequestInit;
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: '棚卸休業',
      holiday_type: 'site_closure',
      is_closed: true,
    });
  });

  it('update (PATCH) encodes a hostile holiday id via encodePathSegment and uses buildOrgJsonHeaders', async () => {
    const fetchMock = stubFetchWithHoliday(holidayFixture('a/b c'));
    renderContent();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を編集',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/business-holidays/a%2Fb%20c',
        expect.objectContaining({ method: 'PATCH', headers: buildOrgJsonHeaders('org_1') }),
      );
    });
  });

  it('update (PATCH) with a dot-segment holiday id fails closed before any PATCH fetch', async () => {
    const fetchMock = stubFetchWithHoliday(holidayFixture('.'));
    renderContent();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を編集',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '更新する' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('DELETE encodes a hostile holiday id via encodePathSegment', async () => {
    const fetchMock = stubFetchWithHoliday(holidayFixture('a/b c'));
    renderContent();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を削除',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/business-holidays/a%2Fb%20c',
        expect.objectContaining({ method: 'DELETE', headers: buildOrgHeaders('org_1') }),
      );
    });
  });

  it('DELETE with a dot-segment holiday id fails closed before any DELETE fetch', async () => {
    const fetchMock = stubFetchWithHoliday(holidayFixture('.'));
    renderContent();

    fireEvent.click(
      await screen.findByRole('button', {
        name: '2026-01-01 年始休業（本店 / 薬局休業日 / 休業）を削除',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });
});
