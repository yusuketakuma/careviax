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
   * クライアント初期化時に現在時刻をセットし、同期処理の成功後に markSynced で更新する。
   * count/state refresh は確認時刻だけを更新し、同期成功とは扱わない。
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
    set({
      pendingSyncCount: count,
      lastSyncRefreshAt: now,
    });
  },
  refreshSyncState: async () => {
    const [count, items] = await Promise.all([getPendingSyncCount(), listSyncQueueItems()]);
    const now = new Date().toISOString();
    set({
      pendingSyncCount: count,
      pendingQueue: items,
      syncConflicts: items.filter((item) => item.conflict_state === 'server_conflict'),
      lastSyncRefreshAt: now,
    });
  },
}));
