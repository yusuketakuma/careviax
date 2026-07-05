// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { SettingValueItem } from '@/lib/admin/settings-catalog';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { SettingsContent } from './settings-content';

setupDomTestEnv();

type QueryOption = {
  queryKey: readonly unknown[];
  queryFn?: () => Promise<unknown>;
};

type SaveMutationOption = {
  mutationFn: () => Promise<unknown>;
};

const SOURCE = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/admin/settings/settings-content.tsx'),
  'utf8',
);

describe('SettingsContent polling policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockImplementation(({ queryKey }: QueryOption) => {
      if (queryKey[0] === 'me-profile') {
        return { data: { data: { id: 'user_1', name: '管理者', defaultSiteId: 'site_1' } } };
      }
      if (queryKey[0] === 'pharmacy-sites') {
        return { data: { data: [{ id: 'site_1', name: '本店' }] } };
      }
      if (queryKey[0] === 'admin-settings') {
        return { data: { data: { scope: queryKey[2], scope_id: queryKey[3] ?? null, items: [] } } };
      }
      return {
        data: {
          status: 'ok',
          timestamp: '2026-06-17T00:00:00.000Z',
          checks: {},
        },
      };
    });
  });

  it('checks health at a lower-frequency admin cadence', () => {
    render(<SettingsContent />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['admin-health-monitor'],
        refetchInterval: 60_000,
      }),
    );
    expect(screen.getAllByLabelText('設定編集モード').length).toBeGreaterThan(0);
  });

  it('renders system health status as Japanese labels, not raw enums', () => {
    render(<SettingsContent />);

    // 全体ステータス ok -> 正常; sub-checks with no data fall back unknown -> 不明.
    expect(screen.getAllByText('正常').length).toBeGreaterThan(0);
    expect(screen.getAllByText('不明').length).toBeGreaterThan(0);
    // Raw English enum tokens must never reach the DOM.
    expect(screen.queryByText('ok')).toBeNull();
    expect(screen.queryByText('unknown')).toBeNull();
  });

  it('labels the JSON settings editor', () => {
    expect(SOURCE).toContain('aria-label="設定JSON"');
  });

  it('uses an announced skeleton while settings are loading', () => {
    useQueryMock.mockImplementation(({ queryKey }: QueryOption) => {
      if (queryKey[0] === 'me-profile') {
        return { data: { data: { id: 'user_1', name: '管理者', defaultSiteId: 'site_1' } } };
      }
      if (queryKey[0] === 'pharmacy-sites') {
        return { data: { data: [{ id: 'site_1', name: '本店' }] } };
      }
      if (queryKey[0] === 'admin-settings') {
        return { data: undefined, isLoading: true };
      }
      return { data: { status: 'ok', timestamp: '2026-06-17T00:00:00.000Z', checks: {} } };
    });

    render(<SettingsContent />);

    expect(screen.getByRole('status', { name: '設定を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('設定を読み込んでいます...')).toBeNull();
  });

  function mockQueryErrorFor(errorKey: string, message: string, refetch: () => void) {
    useQueryMock.mockImplementation(({ queryKey }: QueryOption) => {
      if (queryKey[0] === errorKey) {
        return { data: undefined, isError: true, error: new Error(message), refetch };
      }
      if (queryKey[0] === 'me-profile') {
        return { data: { data: { id: 'user_1', name: '管理者', defaultSiteId: 'site_1' } } };
      }
      if (queryKey[0] === 'pharmacy-sites') {
        return { data: { data: [{ id: 'site_1', name: '本店' }] } };
      }
      if (queryKey[0] === 'admin-settings') {
        return { data: { data: { scope: queryKey[2], scope_id: queryKey[3] ?? null, items: [] } } };
      }
      return { data: { status: 'ok', timestamp: '2026-06-17T00:00:00.000Z', checks: {} } };
    });
  }

  function mockSettingsItems(items: SettingValueItem[]) {
    useQueryMock.mockImplementation(({ queryKey }: QueryOption) => {
      if (queryKey[0] === 'me-profile') {
        return { data: { data: { id: 'user_1', name: '管理者', defaultSiteId: 'site_1' } } };
      }
      if (queryKey[0] === 'pharmacy-sites') {
        return { data: { data: [{ id: 'site_1', name: '本店' }] } };
      }
      if (queryKey[0] === 'admin-settings') {
        return {
          data: {
            data: {
              scope: queryKey[2],
              scope_id: queryKey[3] ?? null,
              items,
            },
          },
        };
      }
      return { data: { status: 'ok', timestamp: '2026-06-17T00:00:00.000Z', checks: {} } };
    });
  }

  it('surfaces a retryable error instead of a perpetual loading health monitor when /api/health fails', () => {
    // false-empty 封止: 取得失敗を「確認中」(loading) カードに畳まず、エラー + 再試行を出す。
    const refetch = vi.fn();
    mockQueryErrorFor('admin-health-monitor', '外部連携監視の取得に失敗しました', refetch);

    render(<SettingsContent />);

    expect(screen.getByText('外部連携監視の取得に失敗しました')).toBeTruthy();
    expect(screen.queryByText('確認中')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows an inline range error and disables Save when a compliance numeric setting is out of range', () => {
    useQueryMock.mockImplementation(({ queryKey }: QueryOption) => {
      if (queryKey[0] === 'me-profile') {
        return { data: { data: { id: 'user_1', name: '管理者', defaultSiteId: 'site_1' } } };
      }
      if (queryKey[0] === 'pharmacy-sites') {
        return { data: { data: [{ id: 'site_1', name: '本店' }] } };
      }
      if (queryKey[0] === 'admin-settings') {
        return {
          data: {
            data: {
              scope: queryKey[2],
              scope_id: queryKey[3] ?? null,
              items:
                queryKey[2] === 'system'
                  ? [
                      {
                        key: 'session_timeout_minutes',
                        label: 'セッションタイムアウト',
                        description: '分単位（3省2GL準拠: 5〜30分）',
                        value: '31',
                        type: 'number',
                        min: 5,
                        max: 30,
                      },
                    ]
                  : [],
            },
          },
        };
      }
      return { data: { status: 'ok', timestamp: '2026-06-17T00:00:00.000Z', checks: {} } };
    });

    render(<SettingsContent />);

    expect(screen.getByText('セッションタイムアウトは30以下で入力してください')).toBeTruthy();

    // isDirty=false の初期表示では保存ボタンは元々無効なので、レンジ検証そのものによる無効化を
    // 別の値へ編集（＝dirty化）した上で確認する。
    const input = screen.getByLabelText('セッションタイムアウト');
    fireEvent.change(input, { target: { value: '99' } });
    expect(screen.getByText('セッションタイムアウトは30以下で入力してください')).toBeTruthy();
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);

    // レンジ内の値に修正するとエラーが消え、dirty な保存ボタンは再び有効になる。
    fireEvent.change(input, { target: { value: '20' } });
    expect(screen.queryByText('セッションタイムアウトは30以下で入力してください')).toBeNull();
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('keeps save mutation error messages', () => {
    render(<SettingsContent />);

    const saveMutationOptions = useMutationMock.mock.calls[0][0];
    saveMutationOptions.onError(new Error('セッションタイムアウトは30以下で入力してください'));

    expect(toast.error).toHaveBeenCalledWith('セッションタイムアウトは30以下で入力してください');
  });

  it('falls back to the save message when mutation failure has no message', () => {
    render(<SettingsContent />);

    const saveMutationOptions = useMutationMock.mock.calls[0][0];
    saveMutationOptions.onError({});

    expect(toast.error).toHaveBeenCalledWith('設定の保存に失敗しました');
  });

  it('surfaces a retryable error instead of an empty store selector when /api/pharmacy-sites fails', () => {
    const refetch = vi.fn();
    mockQueryErrorFor('pharmacy-sites', '店舗一覧の取得に失敗しました', refetch);

    render(<SettingsContent />);

    // 店舗セレクタは「店舗」タブ配下にあるため、タブを開いてから検証する。
    fireEvent.click(screen.getByRole('tab', { name: '店舗' }));

    expect(screen.getByText('店舗一覧の取得に失敗しました')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('saves settings through the shared JSON reader with org JSON headers', async () => {
    const sessionTimeoutItem = {
      key: 'session_timeout_minutes',
      label: 'セッションタイムアウト',
      value: '20',
      type: 'number' as const,
      min: 5,
      max: 30,
    };
    mockSettingsItems([sessionTimeoutItem]);
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          scope: 'system',
          scope_id: null,
          items: [sessionTimeoutItem],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsContent />);

    const saveMutationOptions = useMutationMock.mock.calls[0]?.[0] as SaveMutationOption;
    await expect(saveMutationOptions.mutationFn()).resolves.toEqual({
      data: {
        scope: 'system',
        scope_id: null,
        items: [sessionTimeoutItem],
      },
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify({
        scope: 'system',
        scope_id: null,
        values: { session_timeout_minutes: '20' },
      }),
    });
  });

  it('keeps server messages and fallback copy when settings save fails', async () => {
    mockSettingsItems([
      {
        key: 'session_timeout_minutes',
        label: 'セッションタイムアウト',
        value: '20',
        type: 'number',
        min: 5,
        max: 30,
      },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsContent />);

    const saveMutationOptions = useMutationMock.mock.calls[0]?.[0] as SaveMutationOption;

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: '設定の更新権限がありません' }), { status: 403 }),
    );
    await expect(saveMutationOptions.mutationFn()).rejects.toThrow('設定の更新権限がありません');

    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 500 }));
    await expect(saveMutationOptions.mutationFn()).rejects.toThrow('設定の保存に失敗しました');
  });

  it('uses the shared JSON reader for read-only settings queries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/me/profile') {
        return Response.json({
          data: { id: 'user_1', name: '管理者', defaultSiteId: 'site_1' },
        });
      }
      if (url === '/api/pharmacy-sites') {
        return Response.json({ data: [{ id: 'site_1', name: '本店' }] });
      }
      if (url === '/api/settings?scope=system') {
        expect(init?.headers).toEqual({ 'x-org-id': 'org_1' });
        return Response.json({ data: { scope: 'system', scope_id: null, items: [] } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SettingsContent />);

    const queryOptions = useQueryMock.mock.calls.map(([options]) => options as QueryOption);
    const profileQuery = queryOptions.find((option) => option.queryKey[0] === 'me-profile');
    const sitesQuery = queryOptions.find((option) => option.queryKey[0] === 'pharmacy-sites');
    const settingsQuery = queryOptions.find(
      (option) =>
        option.queryKey[0] === 'admin-settings' &&
        option.queryKey[2] === 'system' &&
        option.queryKey[3] === null,
    );

    await expect(profileQuery?.queryFn?.()).resolves.toEqual({
      data: { id: 'user_1', name: '管理者', defaultSiteId: 'site_1' },
    });
    await expect(sitesQuery?.queryFn?.()).resolves.toEqual({
      data: [{ id: 'site_1', name: '本店' }],
    });
    await expect(settingsQuery?.queryFn?.()).resolves.toEqual({
      data: { scope: 'system', scope_id: null, items: [] },
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/me/profile');
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacy-sites', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/settings?scope=system', {
      headers: { 'x-org-id': 'org_1' },
    });
  });
});
