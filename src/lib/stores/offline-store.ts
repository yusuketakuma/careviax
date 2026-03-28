import { create } from 'zustand';
import { getPendingSyncCount, listSyncQueueItems, type SyncQueueItemSummary } from '@/lib/stores/sync-engine';

interface OfflineState {
  isOffline: boolean;
  pendingSyncCount: number;
  pendingQueue: SyncQueueItemSummary[];
  syncConflicts: SyncQueueItemSummary[];
  cacheTtlHours: number;
  lastSyncRefreshAt: string | null;
  syncOnlineStatus: () => void;
  refreshSyncState: () => Promise<void>;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOffline: false,
  pendingSyncCount: 0,
  pendingQueue: [],
  syncConflicts: [],
  cacheTtlHours: 24,
  lastSyncRefreshAt: null,
  syncOnlineStatus: () => {
    if (typeof window === 'undefined') return;
    set({ isOffline: !window.navigator.onLine });
  },
  refreshSyncState: async () => {
    const [count, items] = await Promise.all([getPendingSyncCount(), listSyncQueueItems()]);
    set({
      pendingSyncCount: count,
      pendingQueue: items,
      syncConflicts: items.filter((item) => item.conflict_state === 'server_conflict'),
      lastSyncRefreshAt: new Date().toISOString(),
    });
  },
}));
