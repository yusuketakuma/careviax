// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { toast } from 'sonner';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  BUSINESS_HOLIDAYS_API_PATH,
  buildBusinessHolidayApiPath,
  buildBusinessHolidaysApiPath,
} from '@/lib/business-holidays/api-paths';

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
// literal would not carry the sentinel. The business-holiday API path helpers are
// mocked with their real implementation so tests can assert callsite delegation
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

vi.mock('@/lib/business-holidays/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/business-holidays/api-paths')>();
  return {
    ...actual,
    buildBusinessHolidayApiPath: vi.fn(actual.buildBusinessHolidayApiPath),
    buildBusinessHolidaysApiPath: vi.fn(actual.buildBusinessHolidaysApiPath),
  };
});

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

    if (url.startsWith(`${BUSINESS_HOLIDAYS_API_PATH}?`)) {
      return new Response(JSON.stringify({ data: [holiday] }), { status: 200 });
    }

    if (url === BUSINESS_HOLIDAYS_API_PATH && init?.method === 'POST') {
      return new Response(JSON.stringify({ message: '休日を登録しました' }), { status: 200 });
    }

    if (url.startsWith(`${BUSINESS_HOLIDAYS_API_PATH}/`) && init?.method === 'PATCH') {
      return new Response(JSON.stringify({ message: '休日を更新しました' }), { status: 200 });
    }

    if (url.startsWith(`${BUSINESS_HOLIDAYS_API_PATH}/`) && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ message: '休日を削除しました' }), { status: 200 });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchWithHolidaysError() {
  // 休日 GET だけ 500、店舗一覧は 200。false-empty(休日数0/カレンダー空白)に潰れないことを検証する。
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/pharmacy-sites') {
      return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
        status: 200,
      });
    }
    if (url.startsWith(`${BUSINESS_HOLIDAYS_API_PATH}?`)) {
      return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
    }
    return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchWithSitesError(holiday = holidayFixture()) {
  // 店舗一覧だけ 500。休日 GET は 200。店舗フィルタ欠落を明示することを検証する。
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/pharmacy-sites') {
      return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
    }
    if (url.startsWith(`${BUSINESS_HOLIDAYS_API_PATH}?`)) {
      return new Response(JSON.stringify({ data: [holiday] }), { status: 200 });
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
      String(input).startsWith(`${BUSINESS_HOLIDAYS_API_PATH}?`),
    );
    const holidaysPathCall = vi
      .mocked(buildBusinessHolidaysApiPath)
      .mock.calls.find(([params]) => params instanceof URLSearchParams);

    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(holidaysPathCall).toBeTruthy();
    expect((holidaysPathCall![0] as URLSearchParams).toString()).toContain('date_from=');
    expect((holidaysPathCall![0] as URLSearchParams).toString()).toContain('date_to=');
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
    expect(buildBusinessHolidayApiPath).toHaveBeenCalledWith('holiday_1');
  });

  it('places the calendar workspace before summary cards and keeps desktop controls at page-body target size', async () => {
    renderContent();

    await screen.findByLabelText('店舗フィルタ');

    const monthTitle = screen.getByText(/年\d+月/);
    const listTitle = screen.getByText('休日一覧');
    const summaryTitle = screen.getByText('今月の休日数');
    expect(
      monthTitle.compareDocumentPosition(summaryTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      listTitle.compareDocumentPosition(summaryTitle) & Node.DOCUMENT_POSITION_FOLLOWING,
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

  it('create (POST) delegates to buildOrgJsonHeaders and the collection path helper', async () => {
    const fetchMock = stubFetchWithHoliday();
    renderContent();

    await screen.findByLabelText('店舗フィルタ');
    fireEvent.click(await screen.findByLabelText('1日'));
    fireEvent.change(screen.getByLabelText('休日名'), { target: { value: '臨時休業' } });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === BUSINESS_HOLIDAYS_API_PATH &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    expect(buildBusinessHolidaysApiPath).toHaveBeenCalledWith();
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === BUSINESS_HOLIDAYS_API_PATH &&
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
          String(input) === BUSINESS_HOLIDAYS_API_PATH &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    expect(buildBusinessHolidaysApiPath).toHaveBeenCalledWith();
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === BUSINESS_HOLIDAYS_API_PATH &&
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

  it('update (PATCH) encodes a hostile holiday id via the shared path helper and uses buildOrgJsonHeaders', async () => {
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
    expect(buildBusinessHolidayApiPath).toHaveBeenCalledWith('a/b c');
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
    expect(buildBusinessHolidayApiPath).toHaveBeenCalledWith('.');
    const patchCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('DELETE encodes a hostile holiday id via the shared path helper', async () => {
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
    expect(buildBusinessHolidayApiPath).toHaveBeenCalledWith('a/b c');
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
    expect(buildBusinessHolidayApiPath).toHaveBeenCalledWith('.');
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('shows the holiday-type label, not the raw enum, in the create and bulk type selects', async () => {
    // bare <SelectValue /> は非空 enum default(site_closure)の生値を漏らす。
    // 明示 children で日本語ラベル(薬局休業日)を表示することを固定する(SSR enum 漏れ封止)。
    // Radix SelectTrigger は getByLabelText で拾いづらいため id 指定で trigger を取得する。
    stubFetchWithHoliday();

    const individual = renderContent();
    await individual.findByLabelText('店舗フィルタ');
    fireEvent.click(await individual.findByLabelText('1日'));
    await individual.findByLabelText('休日名'); // 個別作成フォームが開くのを待つ
    const formType = document.getElementById('holiday-form-type');
    expect(formType?.textContent).toContain('薬局休業日');
    expect(formType?.textContent).not.toContain('site_closure');
    individual.unmount();

    const bulk = renderContent();
    await bulk.findByLabelText('店舗フィルタ');
    fireEvent.click(bulk.getByRole('button', { name: '一括登録' }));
    fireEvent.click(await bulk.findByLabelText('1日')); // 一括フォームは日付選択後に種別欄が出る
    await bulk.findByLabelText('休日名');
    const bulkType = document.getElementById('bulk-holiday-type');
    expect(bulkType?.textContent).toContain('薬局休業日');
    expect(bulkType?.textContent).not.toContain('site_closure');
    bulk.unmount();
  });

  it('surfaces a holidays fetch error instead of collapsing to a false-empty/zero state', async () => {
    const fetchMock = stubFetchWithHolidaysError();
    renderContent();

    // 取得失敗は明示エラーとして出る(「該当なし」に化けない)。
    expect(await screen.findByText('休日設定を読み込めませんでした')).toBeTruthy();
    expect(screen.queryByText('この月の休日設定はありません。')).toBeNull();
    expect(
      screen.getByText('休日一覧を取得できませんでした。上部の再読み込みからやり直してください。'),
    ).toBeTruthy();

    // SummaryCard は 0 件ではなく「—」を表示する(誤った休日数での営業判断を防ぐ)。
    const summaryLabel = screen.getByText('今月の休日数');
    const summaryCard = summaryLabel.parentElement as HTMLElement;
    expect(summaryCard.textContent).toContain('—');
    expect(summaryCard.textContent).not.toContain('0');

    // 再読み込みで休日 GET が再発行される。
    const holidaysCallsBefore = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith(`${BUSINESS_HOLIDAYS_API_PATH}?`),
    ).length;
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    await waitFor(() => {
      const holidaysCallsAfter = fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith(`${BUSINESS_HOLIDAYS_API_PATH}?`),
      ).length;
      expect(holidaysCallsAfter).toBeGreaterThan(holidaysCallsBefore);
    });
  });

  it('surfaces a sites fetch error so the missing store filter is not silent', async () => {
    stubFetchWithSitesError();
    renderContent();

    expect(await screen.findByText('店舗一覧を読み込めませんでした')).toBeTruthy();
    // 休日データ自体は取得できているので休日エラーは出ない。
    expect(screen.queryByText('休日設定を読み込めませんでした')).toBeNull();
    expect(await screen.findByText('年始休業')).toBeTruthy();
  });
});
