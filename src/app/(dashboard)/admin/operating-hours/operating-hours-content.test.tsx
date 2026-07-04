// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { toast } from 'sonner';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// org-header builders mocked with sentinel returns so tests prove the component
// DELEGATES to them rather than hand-building header literals.
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

import { OperatingHoursContent } from './operating-hours-content';

function weeklyFixture() {
  return Array.from({ length: 7 }, (_, weekday) => ({
    id: weekday === 0 ? null : `oh_${weekday}`,
    site_id: 'site_1',
    weekday,
    is_open: weekday !== 0,
    open_time: weekday === 0 ? null : '09:00',
    close_time: weekday === 0 ? null : '18:00',
    note: null,
    configured: weekday !== 0,
    source: weekday === 0 ? 'default' : 'stored',
  }));
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === '/api/pharmacy-sites') {
      return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
        status: 200,
      });
    }

    if (url.startsWith('/api/pharmacy-operating-hours?')) {
      const params = new URL(url, 'http://localhost').searchParams;
      const dateFrom = params.get('date_from') ?? '2026-06-01';
      const secondDay = `${dateFrom.slice(0, 8)}02`;
      return new Response(
        JSON.stringify({
          data: {
            site_id: 'site_1',
            weekly: weeklyFixture(),
            weekly_updated_at: '2026-06-27T00:00:00.000Z',
            resolved_days: [
              {
                date: dateFrom,
                open: false,
                source: 'holiday',
                reason: 'holiday',
                from: null,
                to: null,
              },
              {
                date: secondDay,
                open: false,
                source: 'weekly',
                reason: 'regular_closed',
                from: null,
                to: null,
              },
            ],
          },
        }),
        { status: 200 },
      );
    }

    if (url === '/api/pharmacy-operating-hours' && init?.method === 'PUT') {
      return new Response(
        JSON.stringify({
          data: {
            site_id: 'site_1',
            weekly: weeklyFixture(),
            weekly_updated_at: '2026-06-28T00:00:00.000Z',
          },
        }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderContent() {
  return render(<OperatingHoursContent />, { wrapper: createWrapper() });
}

describe('OperatingHoursContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders 7 weekday editor rows and delegates GET to buildOrgHeaders', async () => {
    const fetchMock = stubFetch();
    renderContent();

    await screen.findByLabelText('月曜日の開始時刻');
    for (const label of ['日', '月', '火', '水', '木', '金', '土']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    const ohGet = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('/api/pharmacy-operating-hours?'),
    );
    expect((ohGet?.[1] as RequestInit | undefined)?.headers).toEqual(buildOrgHeaders('org_1'));
  });

  it('keeps save disabled until a change makes the form dirty', async () => {
    renderContent();

    // wait for the editor to load/sync before asserting the (clean) save state
    const mondayOpen = (await screen.findByLabelText('月曜日の開始時刻')) as HTMLInputElement;
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    await waitFor(() => expect(saveButton.disabled).toBe(true));

    fireEvent.change(mondayOpen, { target: { value: '10:00' } });

    await waitFor(() => expect(saveButton.disabled).toBe(false));
  });

  it('PUTs all seven rows and delegates to buildOrgJsonHeaders on save', async () => {
    const fetchMock = stubFetch();
    renderContent();

    const mondayOpen = (await screen.findByLabelText('月曜日の開始時刻')) as HTMLInputElement;
    fireEvent.change(mondayOpen, { target: { value: '10:00' } });

    const saveButton = await screen.findByRole('button', { name: '保存' });
    await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton);

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === '/api/pharmacy-operating-hours' && init?.method === 'PUT',
      );
      expect(putCall).toBeTruthy();
    });

    const putCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/pharmacy-operating-hours' && init?.method === 'PUT',
    );
    expect((putCall?.[1] as RequestInit | undefined)?.headers).toEqual(
      buildOrgJsonHeaders('org_1'),
    );
    const body = JSON.parse(String((putCall?.[1] as RequestInit | undefined)?.body));
    expect(body.site_id).toBe('site_1');
    expect(body.expected_weekly_updated_at).toBe('2026-06-27T00:00:00.000Z');
    expect(body.rows).toHaveLength(7);
    const monday = body.rows.find((row: { weekday: number }) => row.weekday === 1);
    expect(monday).toMatchObject({ is_open: true, open_time: '10:00', close_time: '18:00' });
    // closed day sends null times
    const sunday = body.rows.find((row: { weekday: number }) => row.weekday === 0);
    expect(sunday).toMatchObject({ is_open: false, open_time: null, close_time: null });
  });

  it('surfaces stale save conflicts and blocks another submit with the stale version', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites') {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url.startsWith('/api/pharmacy-operating-hours?')) {
        return new Response(
          JSON.stringify({
            data: {
              site_id: 'site_1',
              weekly: weeklyFixture(),
              weekly_updated_at: '2026-06-27T00:00:00.000Z',
              resolved_days: [],
            },
          }),
          { status: 200 },
        );
      }
      if (url === '/api/pharmacy-operating-hours' && init?.method === 'PUT') {
        return new Response(
          JSON.stringify({
            code: 'WORKFLOW_CONFLICT',
            message:
              '営業時間設定が他の操作で更新されています。画面を再読み込みしてから保存してください',
          }),
          { status: 409 },
        );
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    const mondayOpen = (await screen.findByLabelText('月曜日の開始時刻')) as HTMLInputElement;
    fireEvent.change(mondayOpen, { target: { value: '10:00' } });

    const saveButton = await screen.findByRole('button', { name: '保存' });
    await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton);

    expect(
      await screen.findByText(
        '営業時間設定が他の操作で更新されています。画面を再読み込みしてから保存してください',
      ),
    ).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(
      '営業時間設定が他の操作で更新されています。画面を再読み込みしてから保存してください',
    );
    expect(screen.getByRole('button', { name: '画面を再読み込み' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);

    const putCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input) === '/api/pharmacy-operating-hours' && init?.method === 'PUT',
    );
    expect(putCalls).toHaveLength(1);
  });

  it('falls back to the operating-hours save message for non-conflict save failures', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites') {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url.startsWith('/api/pharmacy-operating-hours?')) {
        return new Response(
          JSON.stringify({
            data: {
              site_id: 'site_1',
              weekly: weeklyFixture(),
              weekly_updated_at: '2026-06-27T00:00:00.000Z',
              resolved_days: [],
            },
          }),
          { status: 200 },
        );
      }
      if (url === '/api/pharmacy-operating-hours' && init?.method === 'PUT') {
        return new Response(JSON.stringify({}), { status: 500 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    const mondayOpen = (await screen.findByLabelText('月曜日の開始時刻')) as HTMLInputElement;
    fireEvent.change(mondayOpen, { target: { value: '10:00' } });

    const saveButton = await screen.findByRole('button', { name: '保存' });
    await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('営業時間設定の保存に失敗しました');
    });
    expect(screen.queryByRole('button', { name: '画面を再読み込み' })).toBeNull();
  });

  it('treats an all-day open row (null times) as valid and clean, not an error', async () => {
    // Monday open with null/null (e.g. unconfigured default-open) — API accepts this.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites') {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url.startsWith('/api/pharmacy-operating-hours?')) {
        const weekly = weeklyFixture().map((row) =>
          row.weekday === 1 ? { ...row, open_time: null, close_time: null } : row,
        );
        return new Response(
          JSON.stringify({
            data: {
              site_id: 'site_1',
              weekly,
              weekly_updated_at: '2026-06-27T00:00:00.000Z',
              resolved_days: [],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    const mondayOpen = (await screen.findByLabelText('月曜日の開始時刻')) as HTMLInputElement;
    expect(mondayOpen.value).toBe('');
    expect(screen.queryByText('開始時刻と終了時刻は両方入力してください')).toBeNull();
    // clean state (no edits) → save stays disabled
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    await waitFor(() => expect(saveButton.disabled).toBe(true));
  });

  it('blocks save and shows an error when the window end is not after the start', async () => {
    renderContent();

    const mondayOpen = (await screen.findByLabelText('月曜日の開始時刻')) as HTMLInputElement;
    fireEvent.change(mondayOpen, { target: { value: '19:00' } }); // close stays 18:00

    expect(await screen.findByText('終了時刻は開始時刻より後にしてください')).toBeTruthy();
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('renders the resolved operating-day calendar with closure states', async () => {
    renderContent();

    await screen.findByLabelText('月曜日の開始時刻');
    expect(screen.getByText('稼働日カレンダー')).toBeTruthy();
    // resolved_days fixture marks day 1 as 休業 and day 2 as 定休.
    // '休業'/'定休' also appear in the legend, so assert at least one match each.
    await waitFor(() => expect(screen.getAllByText('休業').length).toBeGreaterThan(0));
    expect(screen.getAllByText('定休').length).toBeGreaterThan(0);
  });

  it('does not show false-zero calendar stats when operating-hours fetch fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/pharmacy-sites') {
        return new Response(JSON.stringify({ data: [{ id: 'site_1', name: '本店' }] }), {
          status: 200,
        });
      }
      if (url.startsWith('/api/pharmacy-operating-hours?')) {
        return new Response(JSON.stringify({ message: '営業時間設定の取得に失敗しました' }), {
          status: 500,
        });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderContent();

    expect(await screen.findByText('営業時間設定を取得できませんでした。')).toBeTruthy();
    expect(screen.getByText('稼働日カレンダーを取得できませんでした。')).toBeTruthy();
    expect(screen.queryByText('営業日')).toBeNull();
    expect(screen.queryByText('休業日')).toBeNull();
    expect(screen.queryByText('臨時/短縮営業')).toBeNull();
  });
});
