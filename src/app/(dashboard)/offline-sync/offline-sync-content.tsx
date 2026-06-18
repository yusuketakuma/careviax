'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { decryptOfflinePayload } from '@/lib/offline/crypto';
import { OUTCOME_LABELS } from '@/lib/constants/visit';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { offlineDb } from '@/lib/stores/offline-db';
import { useOfflineStore } from '@/lib/stores/offline-store';
import {
  discardSyncQueueItem,
  overwriteVisitRecordConflict,
  processSyncQueue,
  resetFailedSyncQueueRetries,
} from '@/lib/stores/sync-engine';
import { parseCachedVisitBriefCardPayload } from '@/lib/visits/visit-brief-cache';
import { cn } from '@/lib/utils';
import {
  buildOfflineSyncConflictView,
  buildOfflineSyncRows,
  collectOfflineSyncScheduleIds,
  type OfflineSyncConflictView,
  type OfflineSyncRowStatusKey,
} from './offline-sync.shared';
import { seedOfflineSyncDemoData } from './offline-sync.demo';

/**
 * p0_34「未同期の確認」+ p0_35「データの競合を解消」。
 * 同期キュー(IndexedDB)の状態を一覧し、失敗分の再試行と 409 競合の解決
 * (最新を使う / 自分の入力で上書き)をこの画面に集約する。
 */

const STATUS_BADGE_CLASSES: Record<OfflineSyncRowStatusKey, string> = {
  conflict: 'border-amber-300 bg-amber-50 text-amber-800',
  failed: 'border-red-300 bg-red-50 text-red-700',
  queued: 'border-blue-300 bg-blue-50 text-blue-700',
};

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

  React.useEffect(() => {
    let active = true;
    refreshSyncState().catch((error) => {
      if (!active) return;
      toast.error(error instanceof Error ? error.message : '未同期データの読み込みに失敗しました');
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
      toast.error(error instanceof Error ? error.message : '再試行に失敗しました');
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
      toast.error(error instanceof Error ? error.message : '競合の解決に失敗しました');
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
      toast.error(error instanceof Error ? error.message : '上書き保存に失敗しました');
      await refreshSyncState();
    },
  });

  const conflictActionPending = useServerMutation.isPending || useLocalMutation.isPending;

  if (selectedConflict) {
    return (
      <div className="space-y-5" data-testid="offline-sync-conflict-view">
        <h1 className="text-2xl font-bold tracking-tight text-amber-600">
          他のスタッフが更新しました
        </h1>

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
                className="min-h-11 w-full"
                disabled={conflictActionPending}
                onClick={() => setConfirmingChoice('server')}
              >
                最新の内容を使う
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full text-primary"
                disabled={conflictActionPending || !selectedConflict.canOverwrite}
                onClick={() => setConfirmingChoice('local')}
              >
                自分の入力で上書き
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 w-full"
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
              <div className="mt-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-xs font-medium leading-5 text-amber-900">
                  {confirmingChoice === 'server'
                    ? '自分の入力は破棄され、元に戻せません。最新の内容を残しますか?'
                    : 'サーバーの最新内容を自分の入力で上書きします。元に戻せません。'}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={confirmingChoice === 'server' ? 'destructive' : 'default'}
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
    <div className="space-y-5" data-testid="offline-sync-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">未同期のデータ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          通信が戻ったら自動で送ります。必要なものだけ再試行できます。
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-lg border border-border/70 bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>種類</TableHead>
                <TableHead>患者さん</TableHead>
                <TableHead>状態</TableHead>
                <TableHead>次にやること</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    未同期のデータはありません。すべて同期済みです。
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow key={row.id ?? `row-${index}`} data-testid="offline-sync-row">
                    <TableCell className="font-medium text-foreground">{row.kindLabel}</TableCell>
                    <TableCell>{row.patientLabel}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn('gap-1', STATUS_BADGE_CLASSES[row.statusKey])}
                      >
                        {row.statusLabel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.nextActionKey === 'retry' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="text-primary"
                          disabled={retryAllMutation.isPending}
                          onClick={() => retryAllMutation.mutate()}
                        >
                          再試行
                        </Button>
                      ) : row.nextActionKey === 'resolve_conflict' && row.id !== null ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-amber-300 text-amber-800"
                          onClick={() => setSelectedConflictId(row.id)}
                        >
                          内容を確認
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">そのまま</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>

        <aside className="h-fit rounded-lg border border-border/70 bg-card p-4" aria-label="注意">
          <h2 className="text-sm font-bold text-foreground">注意</h2>
          <p className="mt-3 text-sm font-medium leading-6 text-red-600">
            未同期のデータが残っている間は、訪問完了にできません。
          </p>
          {isOffline ? (
            <p className="mt-2 text-xs leading-5 text-amber-700">
              現在オフラインです。通信が戻ると自動で送信されます。
            </p>
          ) : null}
          <Button
            type="button"
            className="mt-4 min-h-11 w-full"
            disabled={retryAllMutation.isPending || rows.length === 0}
            onClick={() => retryAllMutation.mutate()}
          >
            {retryAllMutation.isPending ? '送信中...' : 'すべて再試行'}
          </Button>
        </aside>
      </div>
    </div>
  );
}
