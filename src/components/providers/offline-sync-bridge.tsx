'use client';

import { useEffect } from 'react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { clientLog } from '@/lib/utils/client-log';
import { useOfflineStore } from '@/lib/stores/offline-store';
import { processSyncQueue } from '@/lib/stores/sync-engine';
import { syncEvidenceDrafts } from '@/lib/offline/evidence-drafts';

function isAllClearDrainResult(value: unknown): value is { failed: number; skipped?: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'failed' in value &&
    typeof (value as { failed?: unknown }).failed === 'number' &&
    (value as { failed: number }).failed === 0 &&
    (!('skipped' in value) ||
      (typeof (value as { skipped?: unknown }).skipped === 'number' &&
        (value as { skipped: number }).skipped === 0))
  );
}

function isBrowserOnline() {
  return typeof window === 'undefined' || window.navigator.onLine;
}

/**
 * アプリ全域のオフライン同期ライフサイクル。従来 record / offline-sync ページに閉じていた
 * bootstrap と自動同期をグローバル化する（null レンダリングの lifecycle bridge）。
 *
 * - CE13: マウント時に offline-store(pendingSyncCount / lastSyncedAt)を IndexedDB の実状態で
 *   hydrate し、以降も各ドレイン完了後に更新する。これがないと record ページ以外では
 *   pendingSyncCount が初期値 0・lastSyncedAt が起動時刻のまま「同期済み」に化ける。
 * - CE12: 起動時と online 復帰時に syncQueue(訪問記録など)をドレインする。record ページを
 *   離れても未同期の医療記録が自動同期される（従来は record-form の page-scoped リスナのみ）。
 * - N21: 起動時と online 復帰時に evidenceDrafts(撮影写真)をドレインする（従来は capture
 *   ページの page-scoped リスナのみ）。
 *
 * processSyncQueue / syncEvidenceDrafts は in-flight coalesce 済みのため、既存の page-scoped
 * 自動同期と同時に発火しても二重実行にはならない（page-scoped 側は撤去せず共存させる）。
 */
export function OfflineSyncBridge() {
  const orgId = useOrgId();
  const refreshSyncState = useOfflineStore((state) => state.refreshSyncState);
  const markSynced = useOfflineStore((state) => state.markSynced);
  const setSyncing = useOfflineStore((state) => state.setSyncing);
  const setSyncFailed = useOfflineStore((state) => state.setSyncFailed);
  const completeSyncAttempt = useOfflineStore((state) => state.completeSyncAttempt);

  useEffect(() => {
    if (!orgId || typeof window === 'undefined') return;

    let cancelled = false;
    // endpoints を空にすると sync-engine 側で DEFAULT_ENDPOINTS(visit_record/residual_medication)
    // に解決される。record-form の page-scoped setupAutoSync も同じ解決結果になるため
    // syncConfigKey が一致し、両者の processSyncQueue は in-flight coalesce で単一実行になる。
    // ※ここで特定の endpoint URL を上書きすると解決結果が分岐して coalesce が外れ、同一
    //   IndexedDB キューへ並行 POST(二重送信)する恐れがあるため、上書きは避けること。
    const config = { orgId, endpoints: {} };

    const refreshState = async () => {
      try {
        await refreshSyncState();
        return true;
      } catch (error) {
        clientLog.warn('offline_sync.state_refresh_failed', error, { route: '/offline-sync' });
        setSyncFailed(true);
        return false;
      }
    };

    // 訪問記録キューと証跡ドラフトを両方ドレインし、両者が確定したら実状態を再取得する。
    const drain = async () => {
      setSyncing(true);
      const queueDone = processSyncQueue(config).catch((error) => {
        clientLog.warn('offline_sync.queue_drain_failed', error, { route: '/offline-sync' });
        return null;
      });
      const evidenceDone = syncEvidenceDrafts({ orgId }).catch((error) => {
        clientLog.warn('offline_sync.evidence_drain_failed', error, { route: '/offline-sync' });
        return null;
      });
      const [queueResult, evidenceResult] = await Promise.all([queueDone, evidenceDone]);
      if (cancelled) return;

      const refreshed = await refreshState();
      if (cancelled) return;

      const allClear =
        isBrowserOnline() &&
        isAllClearDrainResult(queueResult) &&
        isAllClearDrainResult(evidenceResult) &&
        refreshed;
      completeSyncAttempt(allClear);
      if (allClear) markSynced();
    };

    // 起動時: まず実状態を即反映（保留件数を素早く見せる）→ 保留分をドレイン。
    const bootstrap = refreshState();
    void bootstrap.then(() => {
      if (!cancelled) void drain();
    });

    const handleOnline = () => {
      void bootstrap.then(() => {
        if (!cancelled) void drain();
      });
    };
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      setSyncing(false);
      window.removeEventListener('online', handleOnline);
    };
  }, [completeSyncAttempt, markSynced, orgId, refreshSyncState, setSyncFailed, setSyncing]);

  return null;
}
