import { create } from 'zustand';
import {
  getPendingSyncCount,
  listSyncQueueItems,
  type SyncQueueItemSummary,
} from '@/lib/stores/sync-engine';

interface OfflineState {
  isOffline: boolean;
  hasHydratedSyncState: boolean;
  isSyncing: boolean;
  syncFailed: boolean;
  pendingSyncCount: number;
  pendingQueue: SyncQueueItemSummary[];
  syncConflicts: SyncQueueItemSummary[];
  cacheTtlHours: number;
  lastSyncRefreshAt: string | null;
  /** 最終成功時刻。現在のキューが空であることの証明には使わない。 */
  lastSyncedAt: string | null;
  syncOnlineStatus: () => void;
  setSyncing: (isSyncing: boolean) => void;
  setSyncFailed: (syncFailed: boolean) => void;
  completeSyncAttempt: (succeeded: boolean) => void;
  markSynced: (at?: Date) => void;
  refreshSyncCount: () => Promise<void>;
  refreshSyncState: () => Promise<void>;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOffline: false,
  hasHydratedSyncState: false,
  isSyncing: false,
  syncFailed: false,
  pendingSyncCount: 0,
  pendingQueue: [],
  syncConflicts: [],
  cacheTtlHours: 24,
  lastSyncRefreshAt: null,
  lastSyncedAt: null,
  syncOnlineStatus: () => {
    if (typeof window === 'undefined') return;
    set({ isOffline: !window.navigator.onLine });
  },
  setSyncing: (isSyncing) => set({ isSyncing }),
  setSyncFailed: (syncFailed) => set({ syncFailed }),
  completeSyncAttempt: (succeeded) => {
    set((state) => ({
      isSyncing: false,
      syncFailed:
        !succeeded ||
        state.pendingQueue.some(
          (item) => item.conflict_state !== 'server_conflict' && Boolean(item.lastError),
        ),
    }));
  },
  markSynced: (at) => {
    set((state) => {
      const hasQueueFailure = state.pendingQueue.some(
        (item) => item.conflict_state !== 'server_conflict' && Boolean(item.lastError),
      );
      if (
        !state.hasHydratedSyncState ||
        state.pendingSyncCount > 0 ||
        state.syncConflicts.length > 0 ||
        state.syncFailed ||
        hasQueueFailure
      ) {
        return state;
      }
      return { lastSyncedAt: (at ?? new Date()).toISOString() };
    });
  },
  refreshSyncCount: async () => {
    const count = await getPendingSyncCount();
    const now = new Date().toISOString();
    set({
      pendingSyncCount: count,
      lastSyncRefreshAt: now,
    });
  },
  refreshSyncState: async () => {
    try {
      const [count, items] = await Promise.all([getPendingSyncCount(), listSyncQueueItems()]);
      const now = new Date().toISOString();
      set({
        hasHydratedSyncState: true,
        pendingSyncCount: count,
        pendingQueue: items,
        syncConflicts: items.filter((item) => item.conflict_state === 'server_conflict'),
        lastSyncRefreshAt: now,
      });
    } catch (error) {
      set({ syncFailed: true });
      throw error;
    }
  },
}));
