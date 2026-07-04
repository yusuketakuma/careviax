// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildNavBadgesApiPath } from '@/lib/nav-badges/api-paths';
import { jsonResponse } from '@/test/fetch-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';

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
  function createQueryWrapper() {
    return createQueryClientWrapper();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: { audit: 6, handoff: 3 } })),
    );
  });

  it('loads sidebar badges through the aggregated endpoint', async () => {
    const { result } = renderHook(() => useNavBadges(), { wrapper: createQueryWrapper() });

    await waitFor(() => {
      expect(result.current).toEqual({ '/audit': 6, '/handoff': 3 });
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(buildNavBadgesApiPath(), {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('does not fetch badges until an org id is available', () => {
    useOrgIdMock.mockReturnValue('');

    const { result } = renderHook(() => useNavBadges(), { wrapper: createQueryWrapper() });

    expect(result.current).toEqual({ '/audit': undefined, '/handoff': undefined });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hides badges without reading response bodies or logging when the endpoint fails', async () => {
    const jsonMock = vi.fn(async () => ({
      error: 'patient:山田太郎 medication:ワルファリン',
    }));
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: jsonMock,
    } as unknown as Response);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { result } = renderHook(() => useNavBadges(), { wrapper: createQueryWrapper() });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    expect(result.current).toEqual({ '/audit': undefined, '/handoff': undefined });
    expect(jsonMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('does not retry rejected badge fetches', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('patient:山田太郎 medication:ワルファリン'));

    const { result } = renderHook(() => useNavBadges(), { wrapper: createQueryWrapper() });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    expect(result.current).toEqual({ '/audit': undefined, '/handoff': undefined });
  });
});
