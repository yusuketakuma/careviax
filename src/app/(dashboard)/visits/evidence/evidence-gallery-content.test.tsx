// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

import { EvidenceGalleryContent } from './evidence-gallery-content';

setupDomTestEnv();

const OFFLINE_DRAFT_ERROR_TEXT = /端末内の未同期下書きを読み込めませんでした/;

type SetupOptions = {
  offlineDraftsError?: boolean;
};

function setupQueries(options: SetupOptions = {}) {
  const refetchServer = vi.fn();
  const refetchOfflineDrafts = vi.fn();
  useOrgIdMock.mockReturnValue('org_1');
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    const [scope] = queryKey;
    if (scope === 'visit-evidence-gallery') {
      return { data: [], isLoading: false, isError: false, refetch: refetchServer };
    }
    if (scope === 'visit-evidence-offline-drafts') {
      return {
        data: options.offlineDraftsError ? undefined : [],
        isError: Boolean(options.offlineDraftsError),
        refetch: refetchOfflineDrafts,
      };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  });
  return { refetchOfflineDrafts };
}

describe('EvidenceGalleryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not warn when the offline draft query succeeds', () => {
    setupQueries();
    render(<EvidenceGalleryContent />);
    expect(screen.queryByText(OFFLINE_DRAFT_ERROR_TEXT)).toBeNull();
  });

  it('surfaces a retryable warning instead of hiding unsynced drafts when the offline draft query fails (CXR2-FE01)', () => {
    const { refetchOfflineDrafts } = setupQueries({ offlineDraftsError: true });
    render(<EvidenceGalleryContent />);

    // 端末内の未同期下書き取得失敗を空(false-empty)に潰さず明示する。
    expect(screen.getByText(OFFLINE_DRAFT_ERROR_TEXT)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetchOfflineDrafts).toHaveBeenCalledTimes(1);
  });
});
