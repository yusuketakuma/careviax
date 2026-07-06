// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncQueueItemSummary } from './sync-engine';

const syncEngineMocks = vi.hoisted(() => ({
  getPendingSyncCount: vi.fn(),
  listSyncQueueItems: vi.fn(),
}));

vi.mock('./sync-engine', () => ({
  getPendingSyncCount: syncEngineMocks.getPendingSyncCount,
  listSyncQueueItems: syncEngineMocks.listSyncQueueItems,
}));

import { useOfflineStore } from './offline-store';

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

function resetOfflineStore() {
  useOfflineStore.setState({
    isOffline: false,
    pendingSyncCount: 0,
    pendingQueue: [],
    syncConflicts: [],
    cacheTtlHours: 24,
    lastSyncRefreshAt: null,
    lastSyncedAt: null,
  });
}

describe('offline store sync refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setNavigatorOnline(true);
    resetOfflineStore();
    syncEngineMocks.getPendingSyncCount.mockResolvedValue(0);
    syncEngineMocks.listSyncQueueItems.mockResolvedValue([]);
  });

  it('refreshes the pending count without decrypting queue details', async () => {
    syncEngineMocks.getPendingSyncCount.mockResolvedValue(3);

    await useOfflineStore.getState().refreshSyncCount();

    expect(syncEngineMocks.getPendingSyncCount).toHaveBeenCalledTimes(1);
    expect(syncEngineMocks.listSyncQueueItems).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().pendingSyncCount).toBe(3);
    expect(useOfflineStore.getState().pendingQueue).toEqual([]);
    expect(useOfflineStore.getState().syncConflicts).toEqual([]);
  });

  it('does not update the synced timestamp during count refreshes', async () => {
    useOfflineStore.setState({
      lastSyncRefreshAt: '2026-06-18T08:00:00.000Z',
      lastSyncedAt: '2026-06-18T08:00:00.000Z',
    });
    syncEngineMocks.getPendingSyncCount.mockResolvedValue(2);

    await useOfflineStore.getState().refreshSyncCount();

    const state = useOfflineStore.getState();
    expect(state.pendingSyncCount).toBe(2);
    expect(state.lastSyncRefreshAt).not.toBe('2026-06-18T08:00:00.000Z');
    expect(state.lastSyncedAt).toBe('2026-06-18T08:00:00.000Z');
  });

  it('keeps the previous synced timestamp during offline count refreshes', async () => {
    setNavigatorOnline(false);
    useOfflineStore.setState({
      lastSyncRefreshAt: '2026-06-18T08:00:00.000Z',
      lastSyncedAt: '2026-06-18T08:00:00.000Z',
    });
    syncEngineMocks.getPendingSyncCount.mockResolvedValue(4);

    await useOfflineStore.getState().refreshSyncCount();

    const state = useOfflineStore.getState();
    expect(state.pendingSyncCount).toBe(4);
    expect(state.lastSyncRefreshAt).not.toBe('2026-06-18T08:00:00.000Z');
    expect(state.lastSyncedAt).toBe('2026-06-18T08:00:00.000Z');
  });

  it('updates the synced timestamp only through markSynced', () => {
    useOfflineStore.setState({
      lastSyncRefreshAt: '2026-06-18T08:00:00.000Z',
      lastSyncedAt: '2026-06-18T08:00:00.000Z',
    });

    useOfflineStore.getState().markSynced(new Date('2026-06-18T09:30:00.000Z'));

    expect(useOfflineStore.getState().lastSyncedAt).toBe('2026-06-18T09:30:00.000Z');
  });

  it('preserves existing sync state when count refresh fails', async () => {
    const previousState = {
      pendingSyncCount: 7,
      lastSyncRefreshAt: '2026-06-18T08:00:00.000Z',
      lastSyncedAt: '2026-06-18T08:00:00.000Z',
    };
    useOfflineStore.setState(previousState);
    syncEngineMocks.getPendingSyncCount.mockRejectedValue(new Error('IndexedDB unavailable'));

    await expect(useOfflineStore.getState().refreshSyncCount()).rejects.toThrow(
      'IndexedDB unavailable',
    );

    expect(useOfflineStore.getState()).toMatchObject(previousState);
  });

  it('refreshes queue details only when the detailed refresh is requested', async () => {
    const conflictItem: SyncQueueItemSummary = {
      id: 7,
      entityType: 'visit_record',
      payload: { schedule_id: 'schedule-1' },
      scope_id: 'schedule-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      retryCount: 3,
      lastError: 'HTTP 409 conflict',
      conflict_state: 'server_conflict',
      conflict: { local: { schedule_id: 'schedule-1' }, server: null },
    };
    syncEngineMocks.getPendingSyncCount.mockResolvedValue(1);
    syncEngineMocks.listSyncQueueItems.mockResolvedValue([conflictItem]);

    await useOfflineStore.getState().refreshSyncState();

    expect(syncEngineMocks.getPendingSyncCount).toHaveBeenCalledTimes(1);
    expect(syncEngineMocks.listSyncQueueItems).toHaveBeenCalledTimes(1);
    expect(useOfflineStore.getState().pendingQueue).toEqual([conflictItem]);
    expect(useOfflineStore.getState().syncConflicts).toEqual([conflictItem]);
  });
});
