// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';

setupDomTestEnv();

const { buildOrgHeadersMock, buildOrgJsonHeadersMock, fetchMock, routerPushMock } = vi.hoisted(
  () => ({
    buildOrgHeadersMock: vi.fn((orgId: string) => ({
      'x-org-id': `org-header:${orgId}`,
      'x-test-helper': 'buildOrgHeaders',
    })),
    buildOrgJsonHeadersMock: vi.fn((orgId: string) => ({
      'Content-Type': 'application/json',
      'x-org-id': `org-json:${orgId}`,
      'x-test-helper': 'buildOrgJsonHeaders',
    })),
    fetchMock: vi.fn(),
    routerPushMock: vi.fn(),
  }),
);

vi.mock('@/lib/api/org-headers', () => ({
  buildOrgHeaders: buildOrgHeadersMock,
  buildOrgJsonHeaders: buildOrgJsonHeadersMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import type { SavedViewRecord } from '@/lib/views/saved-filter-views';
import { SavedViewsContent } from './saved-views-content';

function renderPage() {
  return render(<SavedViewsContent />, { wrapper: createQueryClientWrapper() });
}

function mockPreferences(value: Record<string, unknown>, savedViews: SavedViewRecord[] = []) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.startsWith('/api/saved-views')) {
      if (init?.method === 'POST' || init?.method === 'PATCH' || init?.method === 'DELETE') {
        return jsonResponse({ data: null });
      }
      return jsonResponse({ data: savedViews });
    }

    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ data: { ...value, ...body } });
    }
    return jsonResponse({ data: value });
  });
}

describe('SavedViewsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mockPreferences({ work_mode: 'pharmacist' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the p1_01 heading and the four preset cards with their destinations', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'よく使う絞り込み' })).toBeTruthy();
    // 説明文は WorkflowPageHeader の HelpPopover に集約され、見出しは h1 のまま維持される。
    expect(document.querySelector('[data-page-header="true"]')).toBeTruthy();

    expect(screen.getByText('朝の確認')).toBeTruthy();
    expect(screen.getByText('セット担当')).toBeTruthy();
    expect(screen.getByText('事務で確認')).toBeTruthy();
    expect(screen.getByText('管理者用')).toBeTruthy();

    const useLinks = screen.getAllByTestId('saved-view-preset-use');
    expect(useLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/my-day?focus=visits&visit_filter=unprepared',
      '/set',
      '/clerk-support',
      '/dashboard',
    ]);
    await waitFor(() => {
      expect(screen.getAllByTestId('current-filter-chip')).toHaveLength(5);
    });
  });

  it('shows the default five chips when no saved view exists', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByTestId('current-filter-chip')).toHaveLength(5);
    });
    expect(screen.getAllByTestId('current-filter-chip').map((chip) => chip.textContent)).toEqual([
      '訪問日:今日〜今週',
      '担当:自分',
      '薬切れ:3日以内',
      '処方変更:あり',
      '予定:患者確認待ちを含む',
    ]);
    expect(screen.queryByTestId('current-filter-saved-badge')).toBeNull();
  });

  it('delegates preference and named-view reads to shared org headers and paths', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByTestId('current-filter-chip')).toHaveLength(5);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/preferences',
      expect.objectContaining({
        headers: {
          'x-org-id': 'org-header:org_1',
          'x-test-helper': 'buildOrgHeaders',
        },
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/saved-views?scope=schedules',
      expect.objectContaining({
        headers: {
          'x-org-id': 'org-header:org_1',
          'x-test-helper': 'buildOrgHeaders',
        },
      }),
    );
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
  });

  it('shows stored conditions and the saved badge when a saved view exists', async () => {
    mockPreferences({
      saved_view: {
        conditions: [{ field: 'assignee', value: 'me' }],
        saved_at: '2026-06-13T09:30:00+09:00',
      },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByTestId('current-filter-chip')).toHaveLength(1);
    });
    expect(screen.getByText('担当:自分')).toBeTruthy();
    expect(screen.getByTestId('current-filter-saved-badge')).toBeTruthy();
  });

  it('saves the current conditions through PATCH /api/me/preferences', async () => {
    renderPage();

    const saveButton = await screen.findByTestId('save-current-filter');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/me/preferences',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect((patchCall?.[1] as RequestInit).headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org-json:org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    const body = JSON.parse(String((patchCall?.[1] as RequestInit).body)) as {
      saved_view: { conditions: unknown[]; saved_at?: string };
    };
    expect(body.saved_view.conditions).toEqual([
      { field: 'visit_date', value: 'today_to_this_week' },
      { field: 'assignee', value: 'me' },
      { field: 'supply_runout', value: 'within_3_days' },
      { field: 'prescription_change', value: 'changed' },
      { field: 'schedule', value: 'include_patient_confirmation' },
    ]);
    expect(typeof body.saved_view.saved_at).toBe('string');

    // 保存成功後はキャッシュ反映で「保存済み」バッジが表示される
    await waitFor(() => {
      expect(screen.getByTestId('current-filter-saved-badge')).toBeTruthy();
    });
  });

  it('applies a named saved view by navigating to the schedule proposals list', async () => {
    mockPreferences({ work_mode: 'pharmacist' }, [
      {
        id: 'view_1',
        name: '患者確認待ち',
        scope: 'schedules',
        filters: {
          conditions: [
            { field: 'visit_date', value: 'today_to_this_week' },
            { field: 'schedule', value: 'include_patient_confirmation' },
          ],
        },
        sort: null,
        isShared: false,
        sortOrder: 0,
        isOwner: true,
        createdAt: '2026-06-13T09:30:00+09:00',
        updatedAt: '2026-06-13T09:30:00+09:00',
      },
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '患者確認待ち' }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledTimes(1);
    });
    const href = String(routerPushMock.mock.calls[0][0]);
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/schedules/proposals');
    expect(url.searchParams.get('workspace')).toBe('dashboard');
    expect(url.searchParams.get('status')).toBe('patient_contact_pending');
    expect(url.searchParams.get('preset')).toBe('contact');
  });

  it('names saved-view row actions by view name before mutation', async () => {
    mockPreferences({ work_mode: 'pharmacist' }, [
      {
        id: 'view_1',
        name: '患者確認待ち',
        scope: 'schedules',
        filters: {
          conditions: [{ field: 'schedule', value: 'include_patient_confirmation' }],
        },
        sort: null,
        isShared: false,
        sortOrder: 0,
        isOwner: true,
        createdAt: '2026-06-13T09:30:00+09:00',
        updatedAt: '2026-06-13T09:30:00+09:00',
      },
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '患者確認待ちの名前を変更' }));

    expect(screen.getByTestId('named-view-name-input')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '患者確認待ちを削除' }));

    expect(screen.getByRole('alertdialog', { name: '保存ビューを削除' })).toBeTruthy();
    expect(
      screen.getByText('「患者確認待ち」を削除します。この操作は取り消せません。'),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url) === '/api/saved-views/view_1' && init?.method === 'DELETE',
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/saved-views/view_1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  it('single-encodes saved-view mutation paths and preserves bodies/headers', async () => {
    const hostileId = 'view/1?x=y#frag';
    const encodedId = encodeURIComponent(hostileId);
    mockPreferences({ work_mode: 'pharmacist' }, [
      {
        id: hostileId,
        name: '患者確認待ち',
        scope: 'schedules',
        filters: {
          conditions: [{ field: 'schedule', value: 'include_patient_confirmation' }],
        },
        sort: null,
        isShared: false,
        sortOrder: 0,
        isOwner: true,
        createdAt: '2026-06-13T09:30:00+09:00',
        updatedAt: '2026-06-13T09:30:00+09:00',
      },
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '患者確認待ちの名前を変更' }));
    fireEvent.change(screen.getByTestId('named-view-rename-input'), {
      target: { value: '新しい名前' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    fireEvent.click(await screen.findByTestId('named-view-share-toggle'));
    fireEvent.click(screen.getByRole('button', { name: '患者確認待ちを削除' }));
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url) === `/api/saved-views/${encodedId}`),
      ).toHaveLength(3);
    });

    const mutationCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === `/api/saved-views/${encodedId}`,
    ) as Array<[string, RequestInit]>;
    expect(mutationCalls.map(([, init]) => init.method)).toEqual(['PATCH', 'PATCH', 'DELETE']);
    expect(mutationCalls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org-json:org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    });
    expect(JSON.parse(String(mutationCalls[0][1].body))).toEqual({ name: '新しい名前' });
    expect(mutationCalls[1][1].headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org-json:org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    });
    expect(JSON.parse(String(mutationCalls[1][1].body))).toEqual({ is_shared: true });
    expect(mutationCalls[2][1].headers).toEqual({
      'x-org-id': 'org-header:org_1',
      'x-test-helper': 'buildOrgHeaders',
    });
    expect(buildOrgJsonHeadersMock).toHaveBeenCalledWith('org_1');
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');

    for (const [url, init] of mutationCalls) {
      expect(url).not.toContain('%25');
      expect(String(init.body ?? '')).not.toContain(hostileId);
    }
  });

  it.each(['.', '..'])(
    'fails closed before saved-view mutation fetch for exact dot id %p',
    async (dotId) => {
      mockPreferences({ work_mode: 'pharmacist' }, [
        {
          id: dotId,
          name: '患者確認待ち',
          scope: 'schedules',
          filters: {
            conditions: [{ field: 'schedule', value: 'include_patient_confirmation' }],
          },
          sort: null,
          isShared: false,
          sortOrder: 0,
          isOwner: true,
          createdAt: '2026-06-13T09:30:00+09:00',
          updatedAt: '2026-06-13T09:30:00+09:00',
        },
      ]);
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: '患者確認待ちの名前を変更' }));
      fireEvent.change(screen.getByTestId('named-view-rename-input'), {
        target: { value: '新しい名前' },
      });
      fireEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(
            ([url, init]) => String(url).startsWith('/api/saved-views?') && init?.method == null,
          ),
        ).toBe(true);
      });
      expect(
        fetchMock.mock.calls.some(([url, init]) => {
          const target = String(url);
          return target.includes(`/api/saved-views/${dotId}`) && init?.method !== undefined;
        }),
      ).toBe(false);
    },
  );

  it('renders the shared workflow page header instead of a raw heading', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'よく使う絞り込み', level: 1 })).toBeTruthy();
    expect(document.querySelector('[data-page-header="true"]')).toBeTruthy();
  });

  it('drops decorative card shadows from the preset, current-filter, and named-views surfaces', async () => {
    renderPage();
    await screen.findByTestId('current-filter-card');

    for (const card of screen.getAllByTestId('saved-view-preset-card')) {
      expect(card.className).not.toContain('shadow-sm');
    }
    expect(screen.getByTestId('current-filter-card').className).not.toContain('shadow-sm');
    expect(screen.getByTestId('named-views-card').className).not.toContain('shadow-sm');
  });

  it('explains why a shared (non-owned) view is visible and hides its owner-only actions', async () => {
    mockPreferences({ work_mode: 'pharmacist' }, [
      {
        id: 'view_shared',
        name: '施設別まとめ',
        scope: 'schedules',
        filters: { conditions: [{ field: 'schedule', value: 'include_patient_confirmation' }] },
        sort: null,
        isShared: true,
        sortOrder: 0,
        isOwner: false,
        createdAt: '2026-06-13T09:30:00+09:00',
        updatedAt: '2026-06-13T09:30:00+09:00',
      },
    ]);
    renderPage();

    expect(await screen.findByTestId('named-view-shared-reason')).toBeTruthy();
    expect(
      screen.getByText('同じ薬局で共有されたビューです。編集・削除はできません。'),
    ).toBeTruthy();
    expect(screen.getByTestId('named-view-shared-tag')).toBeTruthy();
    // 非オーナーは改名・削除・共有トグルを持たない。
    expect(screen.queryByRole('button', { name: '施設別まとめの名前を変更' })).toBeNull();
    expect(screen.queryByRole('button', { name: '施設別まとめを削除' })).toBeNull();
    expect(screen.queryByTestId('named-view-share-toggle')).toBeNull();
    // ビュー名(呼び出し)ボタンは維持。
    expect(screen.getByRole('button', { name: '施設別まとめ' })).toBeTruthy();
  });
});
