// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
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
});
