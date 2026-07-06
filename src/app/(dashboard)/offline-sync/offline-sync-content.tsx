'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumnMeta } from '@/components/ui/data-table';
import { StateBadge } from '@/components/ui/state-badge';
import { decryptOfflinePayload } from '@/lib/offline/crypto';
import { OUTCOME_LABELS } from '@/lib/constants/visit';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import { offlineDb } from '@/lib/stores/offline-db';
import { useOfflineStore } from '@/lib/stores/offline-store';
import {
  discardSyncQueueItem,
  overwriteVisitRecordConflict,
  processSyncQueue,
  resetFailedSyncQueueRetries,
} from '@/lib/stores/sync-engine';
import { parseCachedVisitBriefCardPayload } from '@/lib/visits/visit-brief-cache';
import type { StatusRole } from '@/lib/constants/status-tokens';
import {
  buildOfflineSyncConflictView,
  buildOfflineSyncRows,
  buildOfflineSyncSummary,
  collectOfflineSyncScheduleIds,
  getOfflineSyncLocalOverwriteDisabledReason,
  getOfflineSyncRetryAllDisabledReason,
  type OfflineSyncConflictView,
  type OfflineSyncRow,
  type OfflineSyncRowStatusKey,
} from './offline-sync.shared';
import { seedOfflineSyncDemoData } from './offline-sync.demo';

/**
 * p0_34「未同期の確認」+ p0_35「データの競合を解消」。
 * 同期キュー(IndexedDB)の状態を一覧し、失敗分の再試行と 409 競合の解決
 * (最新を使う / 自分の入力で上書き)をこの画面に集約する。
 */

// 同期キューの行状態 → 6軸セマンティックロール。競合=要確認、失敗=止まっている理由、送信待ち=情報(待ち)。
const STATUS_ROLE: Record<OfflineSyncRowStatusKey, StatusRole> = {
  conflict: 'confirm',
  failed: 'blocked',
  queued: 'info',
};
const OFFLINE_SYNC_LOCAL_OVERWRITE_DISABLED_REASON_ID =
  'offline-sync-local-overwrite-disabled-reason';
const OFFLINE_SYNC_RETRY_ALL_DISABLED_REASON_ID = 'offline-sync-retry-all-disabled-reason';
const OFFLINE_SYNC_QUEUE_ERROR_MESSAGE = '未同期データの読み込みに失敗しました';

/** visitBriefCache から必要な scheduleId だけ患者名の解決マップを作る(ベストエフォート)。 */
async function loadPatientNameMap(scheduleIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (scheduleIds.length === 0) return map;

  try {
    const rows = await offlineDb.visitBriefCache.where('scheduleId').anyOf(scheduleIds).toArray();
    await Promise.all(
      rows.map(async (row) => {
        try {
          const payload = await decryptOfflinePayload(row.payload);
          const parsed = parseCachedVisitBriefCardPayload(payload);
          if (parsed) map.set(parsed.scheduleId, parsed.patientName);
        } catch {
          // 復号できない brief は患者名解決をあきらめる(ID 表示に fallback)
        }
      }),
    );
  } catch {
    // IndexedDB が使えない環境では空マップ
  }
  return map;
}

export function OfflineSyncContent() {
  const orgId = useOrgId();
  const isOffline = useOfflineStore((state) => state.isOffline);
  const pendingQueue = useOfflineStore((state) => state.pendingQueue);
  const refreshSyncState = useOfflineStore((state) => state.refreshSyncState);

  const [patientNames, setPatientNames] = React.useState<Map<string, string>>(new Map());
  const [selectedConflictId, setSelectedConflictId] = React.useState<number | null>(null);
  const [confirmingChoice, setConfirmingChoice] = React.useState<'server' | 'local' | null>(null);
  const [syncQueueError, setSyncQueueError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    refreshSyncState()
      .then(() => {
        if (active) setSyncQueueError(null);
      })
      .catch((error) => {
        if (!active) return;
        const message = messageFromError(error, OFFLINE_SYNC_QUEUE_ERROR_MESSAGE);
        setSyncQueueError(message);
        toast.error(message);
      });

    return () => {
      active = false;
    };
  }, [refreshSyncState]);

  React.useEffect(() => {
    let active = true;
    const scheduleIds = collectOfflineSyncScheduleIds(pendingQueue);
    loadPatientNameMap(scheduleIds).then((names) => {
      if (active) setPatientNames(names);
    });

    return () => {
      active = false;
    };
  }, [pendingQueue]);

  // 撮影・動作確認用のデモ注入(dev 限定)
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    let active = true;
    const target = window;
    target.__phosSeedOfflineSyncDemo = async (mode?: 'queue' | 'conflict') => {
      await seedOfflineSyncDemoData(mode);
      if (!active) return;
      await refreshSyncState();
    };
    return () => {
      active = false;
      delete target.__phosSeedOfflineSyncDemo;
    };
  }, [refreshSyncState]);

  const rows = React.useMemo(
    () => buildOfflineSyncRows(pendingQueue, patientNames),
    [pendingQueue, patientNames],
  );
  const summary = React.useMemo(() => buildOfflineSyncSummary(rows), [rows]);

  const selectedConflict: OfflineSyncConflictView | null = React.useMemo(() => {
    if (selectedConflictId === null) return null;
    const item = pendingQueue.find((entry) => entry.id === selectedConflictId);
    if (!item) return null;
    return buildOfflineSyncConflictView(item, patientNames);
  }, [pendingQueue, selectedConflictId, patientNames]);

  const retryAllMutation = useMutation({
    mutationFn: async () => {
      await resetFailedSyncQueueRetries();
      return processSyncQueue({ orgId, endpoints: {} });
    },
    onSuccess: async (result) => {
      if (result.failed > 0) {
        toast.warning(`送信 ${result.synced}件 / 失敗 ${result.failed}件`, {
          description: '失敗したデータは一覧から個別に確認できます。',
        });
      } else if (result.synced > 0) {
        toast.success(`${result.synced}件を送信しました`);
      } else {
        toast.info('送信待ちのデータはありません');
      }
      await refreshSyncState();
    },
    onError: async (error) => {
      toast.error(messageFromError(error, '再試行に失敗しました'));
      await refreshSyncState();
    },
  });

  const useServerMutation = useMutation({
    mutationFn: async (itemId: number) => discardSyncQueueItem(itemId),
    onSuccess: async () => {
      toast.success('最新の内容を残し、自分の入力を破棄しました');
      setSelectedConflictId(null);
      setConfirmingChoice(null);
      await refreshSyncState();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '競合の解決に失敗しました'));
    },
  });

  const useLocalMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const result = await overwriteVisitRecordConflict({ orgId, endpoints: {} }, itemId);
      if (!result.ok) throw new Error(result.message);
    },
    onSuccess: async () => {
      toast.success('自分の入力で上書き保存しました');
      setSelectedConflictId(null);
      setConfirmingChoice(null);
      await refreshSyncState();
    },
    onError: async (error) => {
      toast.error(messageFromError(error, '上書き保存に失敗しました'));
      await refreshSyncState();
    },
  });

  const conflictActionPending = useServerMutation.isPending || useLocalMutation.isPending;
  const retryAllDisabledReason = getOfflineSyncRetryAllDisabledReason({
    isPending: retryAllMutation.isPending,
    rowCount: rows.length,
  });
  const visibleRetryAllDisabledReason =
    syncQueueError && !retryAllMutation.isPending
      ? '未同期データを読み込めないため、再読み込みしてください。'
      : retryAllDisabledReason;
  const summaryValue = (value: number) => (syncQueueError ? '—' : value);
  const queueColumns: ColumnDef<OfflineSyncRow>[] = [
    {
      accessorKey: 'kindLabel',
      header: '種類',
      meta: { mobileLabel: '種類' } satisfies DataTableColumnMeta<OfflineSyncRow>,
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.kindLabel}</span>
      ),
    },
    {
      accessorKey: 'patientLabel',
      header: '患者さん',
      meta: { mobileLabel: '患者さん' } satisfies DataTableColumnMeta<OfflineSyncRow>,
      cell: ({ row }) => (
        <div>
          <span>{row.original.patientLabel}</span>
          {row.original.lastError ? (
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {row.original.lastError}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: '状態',
      meta: {
        mobileLabel: '状態',
        exportValue: (row) => row.statusLabel,
      } satisfies DataTableColumnMeta<OfflineSyncRow>,
      cell: ({ row }) => (
        <StateBadge role={STATUS_ROLE[row.original.statusKey]}>
          {row.original.statusLabel}
        </StateBadge>
      ),
    },
    {
      id: 'nextAction',
      header: '次にやること',
      meta: {
        mobileLabel: '次にやること',
        exportValue: (row) => row.nextActionLabel,
      } satisfies DataTableColumnMeta<OfflineSyncRow>,
      cell: ({ row }) => (
        <OfflineSyncRowAction
          row={row.original}
          retryPending={retryAllMutation.isPending}
          onRetry={() => retryAllMutation.mutate()}
          onResolve={(id) => setSelectedConflictId(id)}
        />
      ),
    },
  ];

  function retrySyncQueueLoad() {
    setSyncQueueError(null);
    refreshSyncState()
      .then(() => setSyncQueueError(null))
      .catch((error) => {
        const message = messageFromError(error, OFFLINE_SYNC_QUEUE_ERROR_MESSAGE);
        setSyncQueueError(message);
        toast.error(message);
      });
  }

  if (selectedConflict) {
    const localOverwriteDisabledReason = getOfflineSyncLocalOverwriteDisabledReason({
      canOverwrite: selectedConflict.canOverwrite,
      isPending: conflictActionPending,
    });

    return (
      <div className="space-y-4" data-testid="offline-sync-conflict-view">
        <div className="rounded-lg border border-state-confirm/30 bg-state-confirm/10 px-4 py-3">
          <p className="text-xs font-semibold text-state-confirm">競合を確認</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground">
            {selectedConflict.patientLabel}さんの記録が更新されています
          </h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            最新の内容を残すか、自分の入力で上書きするかを選びます。
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
          <section className="rounded-lg border border-border/70 bg-card p-4">
            <h2 className="text-sm font-bold text-foreground">あなたの入力</h2>
            <p className="mt-3 text-sm leading-6 text-foreground">
              訪問メモ:{selectedConflict.localText}
            </p>
            {selectedConflict.localOutcome ? (
              <p className="mt-1 text-sm text-foreground">
                結果:
                {OUTCOME_LABELS[selectedConflict.localOutcome] ?? selectedConflict.localOutcome}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">更新前の内容です。</p>
          </section>

          <section className="rounded-lg border border-border/70 bg-card p-4">
            <h2 className="text-sm font-bold text-foreground">最新の内容</h2>
            <p className="mt-3 text-sm leading-6 text-foreground">
              訪問メモ:{selectedConflict.serverText}
            </p>
            {selectedConflict.serverOutcome ? (
              <p className="mt-1 text-sm text-foreground">
                結果:
                {OUTCOME_LABELS[selectedConflict.serverOutcome] ?? selectedConflict.serverOutcome}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">
              サーバーに保存済みの最新記録です
              {selectedConflict.serverVisitDate
                ? `(訪問日 ${selectedConflict.serverVisitDate})`
                : ''}
              。
            </p>
          </section>

          <section className="rounded-lg border border-border/70 bg-card p-4">
            <h2 className="text-sm font-bold text-foreground">選んでください</h2>
            <div className="mt-3 space-y-2.5">
              <Button
                type="button"
                className="min-h-11 w-full sm:h-11 sm:min-h-11"
                disabled={conflictActionPending}
                onClick={() => setConfirmingChoice('server')}
              >
                最新の内容を使う
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full text-primary sm:h-11 sm:min-h-11"
                aria-describedby={
                  localOverwriteDisabledReason
                    ? OFFLINE_SYNC_LOCAL_OVERWRITE_DISABLED_REASON_ID
                    : undefined
                }
                disabled={conflictActionPending || Boolean(localOverwriteDisabledReason)}
                onClick={() => setConfirmingChoice('local')}
              >
                自分の入力で上書き
              </Button>
              {localOverwriteDisabledReason ? (
                <p
                  id={OFFLINE_SYNC_LOCAL_OVERWRITE_DISABLED_REASON_ID}
                  className="text-xs text-muted-foreground"
                >
                  {localOverwriteDisabledReason}
                </p>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 w-full sm:h-11 sm:min-h-11"
                disabled={conflictActionPending}
                onClick={() => {
                  setSelectedConflictId(null);
                  setConfirmingChoice(null);
                }}
              >
                あとで決める
              </Button>
            </div>
            {confirmingChoice ? (
              <div className="mt-3 space-y-2 rounded-md border border-state-confirm/30 bg-state-confirm/10 px-3 py-3">
                <p className="text-xs font-medium leading-5 text-state-confirm">
                  {confirmingChoice === 'server'
                    ? '自分の入力は破棄され、元に戻せません。最新の内容を残しますか?'
                    : 'サーバーの最新内容を自分の入力で上書きします。元に戻せません。'}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={confirmingChoice === 'server' ? 'destructive' : 'default'}
                    className="min-h-11 sm:h-11 sm:min-h-11"
                    disabled={conflictActionPending}
                    onClick={() => {
                      if (confirmingChoice === 'server') {
                        useServerMutation.mutate(selectedConflict.itemId);
                      } else {
                        useLocalMutation.mutate(selectedConflict.itemId);
                      }
                    }}
                  >
                    {conflictActionPending ? '処理中...' : '確定する'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 sm:h-11 sm:min-h-11"
                    disabled={conflictActionPending}
                    onClick={() => setConfirmingChoice(null)}
                  >
                    キャンセル
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="offline-sync-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">未同期のデータ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            競合と失敗だけを先に確認し、通信復帰後の送信を安全に再開します。
          </p>
        </div>
        <div
          className="rounded-full border border-border/70 bg-card px-3 py-1.5 text-sm font-semibold text-foreground"
          aria-label={
            syncQueueError
              ? '未同期データを読み込めません'
              : `未同期 ${summary.total} 件、要確認 ${summary.needsAction} 件`
          }
        >
          {syncQueueError ? '読込失敗' : `要確認 ${summary.needsAction} / 全${summary.total}`}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3" aria-label="同期状態の内訳">
        <SyncSummaryCard
          label="競合"
          value={summaryValue(summary.conflict)}
          description="他スタッフの更新あり"
          tone="border-state-confirm/30 bg-state-confirm/10 text-state-confirm"
        />
        <SyncSummaryCard
          label="失敗"
          value={summaryValue(summary.failed)}
          description="再送が必要"
          tone="border-destructive/30 bg-destructive/10 text-destructive"
        />
        <SyncSummaryCard
          label="送信待ち"
          value={summaryValue(summary.queued)}
          description="通信復帰で自動送信"
          tone="border-tag-info/30 bg-tag-info/10 text-tag-info"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-lg border border-border/70 bg-card p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-foreground">同期キュー</h2>
              <p className="text-xs text-muted-foreground">患者別に状態と次の操作を確認します。</p>
            </div>
          </div>

          <DataTable
            columns={queueColumns}
            data={rows}
            caption="同期キュー"
            emptyMessage="未同期のデータはありません。すべて同期済みです。"
            errorMessage={syncQueueError ?? undefined}
            errorActionLabel="再読み込み"
            onRetry={retrySyncQueueLoad}
            getRowId={(row, index) => String(row.id ?? `row-${index}`)}
            getRowA11yLabel={(row) => `${row.patientLabel} / ${row.kindLabel}`}
          />
        </section>

        <aside className="h-fit rounded-lg border border-border/70 bg-card p-4" aria-label="注意">
          <h2 className="text-sm font-bold text-foreground">注意</h2>
          <p className="mt-3 text-sm font-medium leading-6 text-destructive">
            未同期のデータが残っている間は、訪問完了にできません。
          </p>
          {isOffline ? (
            <p className="mt-2 text-xs leading-5 text-state-confirm">
              現在オフラインです。通信が戻ると自動で送信されます。
            </p>
          ) : null}
          <Button
            type="button"
            className="mt-4 min-h-11 w-full sm:h-11 sm:min-h-11"
            aria-describedby={
              visibleRetryAllDisabledReason ? OFFLINE_SYNC_RETRY_ALL_DISABLED_REASON_ID : undefined
            }
            disabled={retryAllMutation.isPending || Boolean(visibleRetryAllDisabledReason)}
            onClick={() => retryAllMutation.mutate()}
          >
            {retryAllMutation.isPending ? '送信中...' : '未同期キューをすべて再試行'}
          </Button>
          {visibleRetryAllDisabledReason ? (
            <p
              id={OFFLINE_SYNC_RETRY_ALL_DISABLED_REASON_ID}
              className="mt-2 text-xs text-muted-foreground"
            >
              {visibleRetryAllDisabledReason}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function SyncSummaryCard({
  label,
  value,
  description,
  tone,
}: {
  label: string;
  value: number | string;
  description: string;
  tone: string;
}) {
  return (
    <article className={`rounded-lg border px-3 py-2.5 ${tone}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </div>
      <p className="mt-1 text-xs opacity-80">{description}</p>
    </article>
  );
}

function OfflineSyncRowAction({
  row,
  retryPending,
  onRetry,
  onResolve,
}: {
  row: OfflineSyncRow;
  retryPending: boolean;
  onRetry: () => void;
  onResolve: (id: number) => void;
}) {
  if (row.nextActionKey === 'retry') {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11 text-primary sm:h-11 sm:min-h-11"
        disabled={retryPending}
        onClick={onRetry}
      >
        再試行
      </Button>
    );
  }

  if (row.nextActionKey === 'resolve_conflict' && row.id !== null) {
    const itemId = row.id;
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11 text-state-confirm sm:h-11 sm:min-h-11"
        onClick={() => onResolve(itemId)}
      >
        内容を確認
      </Button>
    );
  }

  return <span className="text-sm text-muted-foreground">そのまま</span>;
}
