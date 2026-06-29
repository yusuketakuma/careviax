// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

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
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
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

  function mockQueryErrorFor(errorKey: string, message: string, refetch: () => void) {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
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
});
