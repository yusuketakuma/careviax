// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const refreshSyncStateMock = vi.hoisted(() => vi.fn());
const markSyncedMock = vi.hoisted(() => vi.fn());
const processSyncQueueMock = vi.hoisted(() => vi.fn());
const syncEvidenceDraftsMock = vi.hoisted(() => vi.fn());
const clientLogWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));

vi.mock('@/lib/stores/offline-store', () => ({
  useOfflineStore: (
    selector: (state: { refreshSyncState: () => Promise<void>; markSynced: () => void }) => unknown,
  ) => selector({ refreshSyncState: refreshSyncStateMock, markSynced: markSyncedMock }),
}));

vi.mock('@/lib/stores/sync-engine', () => ({ processSyncQueue: processSyncQueueMock }));

vi.mock('@/lib/offline/evidence-drafts', () => ({ syncEvidenceDrafts: syncEvidenceDraftsMock }));

vi.mock('@/lib/utils/client-log', () => ({
  clientLog: { warn: clientLogWarnMock },
}));

import { OfflineSyncBridge } from './offline-sync-bridge';

setupDomTestEnv();

describe('OfflineSyncBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    useOrgIdMock.mockReturnValue('org_1');
    refreshSyncStateMock.mockResolvedValue(undefined);
    markSyncedMock.mockReturnValue(undefined);
    processSyncQueueMock.mockResolvedValue({ synced: 0, failed: 0 });
    syncEvidenceDraftsMock.mockResolvedValue({ synced: 0, failed: 0 });
  });

  it('bootstraps offline state and drains both queues on mount', async () => {
    render(<OfflineSyncBridge />);

    // CE13: 実状態を即 hydrate。CE12/N21: 起動時に両キューをドレイン。
    expect(refreshSyncStateMock).toHaveBeenCalled();
    expect(processSyncQueueMock).toHaveBeenCalledWith({ orgId: 'org_1', endpoints: {} });
    expect(syncEvidenceDraftsMock).toHaveBeenCalledWith({ orgId: 'org_1' });

    // ドレイン確定後にもう一度 state を更新する（header 件数を最新化）。
    await waitFor(() => expect(refreshSyncStateMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(markSyncedMock).toHaveBeenCalled();
  });

  it('does not mark synced when either drain path reports failures', async () => {
    processSyncQueueMock.mockResolvedValue({ synced: 0, failed: 1 });

    render(<OfflineSyncBridge />);

    await waitFor(() => expect(processSyncQueueMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refreshSyncStateMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(markSyncedMock).not.toHaveBeenCalled();
  });

  it('does not mark synced while the browser is offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    render(<OfflineSyncBridge />);

    await waitFor(() => expect(processSyncQueueMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refreshSyncStateMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(markSyncedMock).not.toHaveBeenCalled();
  });

  it('does not mark synced when evidence drafts are skipped and remain local', async () => {
    syncEvidenceDraftsMock.mockResolvedValue({ synced: 0, skipped: 1, failed: 0 });

    render(<OfflineSyncBridge />);

    await waitFor(() => expect(syncEvidenceDraftsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refreshSyncStateMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(markSyncedMock).not.toHaveBeenCalled();
  });

  it('records refresh failures with a coded PHI-safe event while preserving successful draining', async () => {
    const error = new Error('患者A token=secret の同期状態を更新できません');
    refreshSyncStateMock.mockRejectedValueOnce(error);

    render(<OfflineSyncBridge />);

    await waitFor(() =>
      expect(clientLogWarnMock).toHaveBeenCalledWith('offline_sync.state_refresh_failed', error, {
        route: '/offline-sync',
      }),
    );
    expect(markSyncedMock).toHaveBeenCalled();
  });

  it('records queue drain failures without marking the queue as synced', async () => {
    const error = new Error('患者A token=secret の訪問記録同期に失敗しました');
    processSyncQueueMock.mockRejectedValueOnce(error);

    render(<OfflineSyncBridge />);

    await waitFor(() =>
      expect(clientLogWarnMock).toHaveBeenCalledWith('offline_sync.queue_drain_failed', error, {
        route: '/offline-sync',
      }),
    );
    expect(markSyncedMock).not.toHaveBeenCalled();
  });

  it('records evidence drain failures without marking evidence as synced', async () => {
    const error = new Error('患者A token=secret の証跡同期に失敗しました');
    syncEvidenceDraftsMock.mockRejectedValueOnce(error);

    render(<OfflineSyncBridge />);

    await waitFor(() =>
      expect(clientLogWarnMock).toHaveBeenCalledWith('offline_sync.evidence_drain_failed', error, {
        route: '/offline-sync',
      }),
    );
    expect(markSyncedMock).not.toHaveBeenCalled();
  });

  it('re-drains both queues when connectivity is restored (online event)', async () => {
    render(<OfflineSyncBridge />);
    await waitFor(() => expect(processSyncQueueMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('online'));

    await waitFor(() => {
      expect(processSyncQueueMock).toHaveBeenCalledTimes(2);
      expect(syncEvidenceDraftsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('does nothing until an org id is available (fail-safe gate)', () => {
    useOrgIdMock.mockReturnValue('');
    render(<OfflineSyncBridge />);

    expect(refreshSyncStateMock).not.toHaveBeenCalled();
    expect(processSyncQueueMock).not.toHaveBeenCalled();
    expect(syncEvidenceDraftsMock).not.toHaveBeenCalled();
  });
});
