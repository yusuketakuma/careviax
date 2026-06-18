import { create } from 'zustand';
import {
  getPendingSyncCount,
  listSyncQueueItems,
  type SyncQueueItemSummary,
} from '@/lib/stores/sync-engine';

interface OfflineState {
  isOffline: boolean;
  pendingSyncCount: number;
  pendingQueue: SyncQueueItemSummary[];
  syncConflicts: SyncQueueItemSummary[];
  cacheTtlHours: number;
  lastSyncRefreshAt: string | null;
  /**
   * 最終同期時刻(ヘッダーの「同期済み HH:MM」表示用)。
   * クライアント初期化時に現在時刻をセットし、processSyncQueue 完了後の
   * refreshSyncState(オンライン時のみ)で更新される。
   */
  lastSyncedAt: string | null;
  syncOnlineStatus: () => void;
  markSynced: (at?: Date) => void;
  refreshSyncCount: () => Promise<void>;
  refreshSyncState: () => Promise<void>;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOffline: false,
  pendingSyncCount: 0,
  pendingQueue: [],
  syncConflicts: [],
  cacheTtlHours: 24,
  lastSyncRefreshAt: null,
  lastSyncedAt: typeof window === 'undefined' ? null : new Date().toISOString(),
  syncOnlineStatus: () => {
    if (typeof window === 'undefined') return;
    set({ isOffline: !window.navigator.onLine });
  },
  markSynced: (at) => {
    set({ lastSyncedAt: (at ?? new Date()).toISOString() });
  },
  refreshSyncCount: async () => {
    const count = await getPendingSyncCount();
    const now = new Date().toISOString();
    const isOnline = typeof window === 'undefined' || window.navigator.onLine;
    set((state) => ({
      pendingSyncCount: count,
      lastSyncRefreshAt: now,
      lastSyncedAt: isOnline ? now : state.lastSyncedAt,
    }));
  },
  refreshSyncState: async () => {
    const [count, items] = await Promise.all([getPendingSyncCount(), listSyncQueueItems()]);
    const now = new Date().toISOString();
    const isOnline = typeof window === 'undefined' || window.navigator.onLine;
    set((state) => ({
      pendingSyncCount: count,
      pendingQueue: items,
      syncConflicts: items.filter((item) => item.conflict_state === 'server_conflict'),
      lastSyncRefreshAt: now,
      lastSyncedAt: isOnline ? now : state.lastSyncedAt,
    }));
  },
}));
