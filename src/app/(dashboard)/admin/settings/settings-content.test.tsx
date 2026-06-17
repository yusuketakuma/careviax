// @vitest-environment jsdom

import { render } from '@testing-library/react';
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
  });
});
