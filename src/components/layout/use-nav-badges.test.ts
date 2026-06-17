// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useOrgIdMock } = vi.hoisted(() => ({
  useOrgIdMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

import { countMyHandoffItems, toBadgeCount, useNavBadges } from './use-nav-badges';

describe('countMyHandoffItems', () => {
  const me = 'user_me';
  const other = 'user_other';

  it('counts items I handed off and items I have not confirmed yet', () => {
    const items = [
      // 自分が渡した(既読有無は問わない)
      { created_by: me, read_by: [] },
      { created_by: me, read_by: [other] },
      // 来た・未確認
      { created_by: other, read_by: [] },
      // 来た・確認済み → 数えない
      { created_by: other, read_by: [me] },
    ];

    expect(countMyHandoffItems(items, me)).toBe(3);
  });

  it('returns 0 when the user is unknown', () => {
    expect(countMyHandoffItems([{ created_by: other, read_by: [] }], null)).toBe(0);
  });

  it('tolerates missing read_by arrays', () => {
    expect(countMyHandoffItems([{ created_by: other }], me)).toBe(1);
  });
});

describe('toBadgeCount', () => {
  it('hides zero and missing counts', () => {
    expect(toBadgeCount(0)).toBeUndefined();
    expect(toBadgeCount(undefined)).toBeUndefined();
  });

  it('passes through positive counts', () => {
    expect(toBadgeCount(6)).toBe(6);
  });
});

describe('useNavBadges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { audit: 6, handoff: 3 } }),
      }),
    );
  });

  it('loads sidebar badges through the aggregated endpoint', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useNavBadges(), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual({ '/audit': 6, '/handoff': 3 });
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/nav-badges', {
      headers: { 'x-org-id': 'org_1' },
    });
  });
});
