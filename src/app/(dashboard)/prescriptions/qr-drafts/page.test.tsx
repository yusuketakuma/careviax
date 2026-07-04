// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';

const { pushMock, refetchAllMock, refetchUnmatchedMock, useOrgIdMock, useRealtimeQueryMock } =
  vi.hoisted(() => ({
    pushMock: vi.fn(),
    refetchAllMock: vi.fn(),
    refetchUnmatchedMock: vi.fn(),
    useOrgIdMock: vi.fn(),
    useRealtimeQueryMock: vi.fn(),
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

import QrDraftsPage from './page';

setupDomTestEnv();

type QueryConfig = {
  queryKey: unknown[];
  queryFn?: () => Promise<unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
  useOrgIdMock.mockReturnValue('org_1');
  useRealtimeQueryMock.mockImplementation((config: QueryConfig) => ({
    data: config.queryKey[2] === 'all' ? { data: [], unmatchedCount: 0 } : { data: [] },
    isLoading: false,
    isError: false,
    refetch: config.queryKey[2] === 'all' ? refetchAllMock : refetchUnmatchedMock,
  }));
});

describe('QrDraftsPage list fetchers', () => {
  it('keeps API messages from failed QR draft list fetches', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: 'QR下書きを表示できません' }, 403),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<QrDraftsPage />);

    const queryConfigs = useRealtimeQueryMock.mock.calls.map(([config]) => config as QueryConfig);
    const allQuery = queryConfigs.find(
      (config) => config.queryKey[0] === 'qr-drafts' && config.queryKey[2] === 'all',
    );
    const unmatchedQuery = queryConfigs.find(
      (config) => config.queryKey[0] === 'qr-drafts' && config.queryKey[2] === 'unmatched',
    );
    if (!allQuery?.queryFn || !unmatchedQuery?.queryFn) {
      throw new Error('QR draft list queryFns were not registered');
    }

    await expect(allQuery.queryFn()).rejects.toThrow('QR下書きを表示できません');
    await expect(unmatchedQuery.queryFn()).rejects.toThrow('QR下書きを表示できません');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/qr-scan-drafts?include_unmatched_count=1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { 'x-org-id': 'org_1' } });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/qr-scan-drafts?unmatched=true');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: { 'x-org-id': 'org_1' } });
  });
});
