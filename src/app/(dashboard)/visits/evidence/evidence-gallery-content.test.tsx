// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { EvidenceGalleryItem } from './evidence-gallery.shared';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const evidenceDraftMocks = vi.hoisted(() => ({
  listEvidenceDraftSummaries: vi.fn(),
  resetFailedEvidenceDraftRetries: vi.fn(),
  syncEvidenceDrafts: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/offline/evidence-drafts', () => ({
  listEvidenceDraftSummaries: evidenceDraftMocks.listEvidenceDraftSummaries,
  resetFailedEvidenceDraftRetries: evidenceDraftMocks.resetFailedEvidenceDraftRetries,
  syncEvidenceDrafts: evidenceDraftMocks.syncEvidenceDrafts,
}));

import { EvidenceGalleryContent } from './evidence-gallery-content';

setupDomTestEnv();

const OFFLINE_DRAFT_ERROR_TEXT = /端末内の未同期下書きを読み込めませんでした/;

type SetupOptions = {
  offlineDraftsError?: boolean;
  offlineDraftItems?: EvidenceGalleryItem[];
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
        data: options.offlineDraftsError ? undefined : (options.offlineDraftItems ?? []),
        isError: Boolean(options.offlineDraftsError),
        refetch: refetchOfflineDrafts,
      };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  });
  return { refetchOfflineDrafts, refetchServer };
}

describe('EvidenceGalleryContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evidenceDraftMocks.resetFailedEvidenceDraftRetries.mockResolvedValue(0);
    evidenceDraftMocks.syncEvidenceDrafts.mockResolvedValue({ synced: 0, skipped: 0, failed: 0 });
  });

  it('does not warn when the offline draft query succeeds', () => {
    setupQueries();
    render(<EvidenceGalleryContent />);
    expect(screen.queryByText(OFFLINE_DRAFT_ERROR_TEXT)).toBeNull();
  });

  it('scopes server and offline draft queries by org id and disables both without org scope', () => {
    setupQueries();
    render(<EvidenceGalleryContent />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['visit-evidence-gallery', 'org_1'],
        enabled: true,
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['visit-evidence-offline-drafts', 'org_1'],
        enabled: true,
      }),
    );

    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('');
    render(<EvidenceGalleryContent />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['visit-evidence-gallery', ''],
        enabled: false,
      }),
    );
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['visit-evidence-offline-drafts', ''],
        enabled: false,
      }),
    );
  });

  it('surfaces a retryable warning instead of hiding unsynced drafts when the offline draft query fails (CXR2-FE01)', async () => {
    const { refetchOfflineDrafts, refetchServer } = setupQueries({ offlineDraftsError: true });
    render(<EvidenceGalleryContent />);

    // 端末内の未同期下書き取得失敗を空(false-empty)に潰さず明示する。
    expect(screen.getByText(OFFLINE_DRAFT_ERROR_TEXT)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    await waitFor(() => {
      expect(evidenceDraftMocks.resetFailedEvidenceDraftRetries).toHaveBeenCalledTimes(1);
    });
    expect(evidenceDraftMocks.resetFailedEvidenceDraftRetries).toHaveBeenCalledWith({
      orgId: 'org_1',
    });
    expect(evidenceDraftMocks.syncEvidenceDrafts).toHaveBeenCalledTimes(1);
    expect(evidenceDraftMocks.syncEvidenceDrafts).toHaveBeenCalledWith({ orgId: 'org_1' });
    expect(refetchOfflineDrafts).toHaveBeenCalledTimes(1);
    expect(refetchServer).toHaveBeenCalledTimes(1);
  });

  it('resets retry-exhausted evidence drafts and attempts sync from the gallery summary', async () => {
    const { refetchOfflineDrafts, refetchServer } = setupQueries({
      offlineDraftItems: [
        {
          id: 'offline-draft-1',
          category: 'residual_photo',
          syncState: 'pending',
          capturedAt: '2026-06-01T00:00:00.000Z',
          fileName: 'retry.jpg',
        },
      ],
    });
    evidenceDraftMocks.resetFailedEvidenceDraftRetries.mockResolvedValue(1);
    evidenceDraftMocks.syncEvidenceDrafts
      .mockResolvedValueOnce({ synced: 0, skipped: 0, failed: 0 })
      .mockResolvedValueOnce({ synced: 1, skipped: 0, failed: 0 });
    render(<EvidenceGalleryContent />);

    fireEvent.click(screen.getByRole('button', { name: '未同期写真を再試行' }));

    await waitFor(() => {
      expect(evidenceDraftMocks.resetFailedEvidenceDraftRetries).toHaveBeenCalledTimes(1);
    });
    expect(evidenceDraftMocks.resetFailedEvidenceDraftRetries).toHaveBeenCalledWith({
      orgId: 'org_1',
    });
    expect(evidenceDraftMocks.syncEvidenceDrafts).toHaveBeenCalledTimes(2);
    expect(evidenceDraftMocks.syncEvidenceDrafts).toHaveBeenNthCalledWith(1, { orgId: 'org_1' });
    expect(evidenceDraftMocks.syncEvidenceDrafts).toHaveBeenNthCalledWith(2, { orgId: 'org_1' });
    expect(refetchOfflineDrafts).toHaveBeenCalledTimes(1);
    expect(refetchServer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain(
      '未同期写真を再試行しました。送信 1件。',
    );
  });
});
