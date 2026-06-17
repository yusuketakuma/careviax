// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

setupDomTestEnv();

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SavedViewsContent } from './saved-views-content';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SavedViewsContent />
    </QueryClientProvider>,
  );
}

function mockPreferences(value: Record<string, unknown>) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return { ok: true, json: async () => ({ data: { ...value, ...body } }) };
    }
    return { ok: true, json: async () => ({ data: value }) };
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
    expect(
      screen.getByText('朝の確認・施設別・自分の担当などをすぐ呼び出します。'),
    ).toBeTruthy();

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
    expect(
      screen.getAllByTestId('current-filter-chip').map((chip) => chip.textContent),
    ).toEqual([
      '訪問日:今日〜今週',
      '担当:自分',
      '薬切れ:3日以内',
      '処方変更:あり',
      '予定:患者確認待ちを含む',
    ]);
    expect(screen.queryByTestId('current-filter-saved-badge')).toBeNull();
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
});
