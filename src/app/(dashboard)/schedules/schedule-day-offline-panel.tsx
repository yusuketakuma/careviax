'use client';

import Link from 'next/link';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CachedVisitBriefCard } from '@/lib/visits/visit-brief-cache';
import { timeLabel } from './day-view.shared';
import type { ScheduleDayOfflineStatusViewModel } from './schedule-day-view.helpers';

export type ScheduleDaySyncConflictItem = {
  id?: number;
  scope_id?: string | null;
  lastError?: string | null;
  conflict?: {
    local: {
      outcome_status?: unknown;
      soap_plan?: unknown;
    };
    server?: {
      outcome_status?: string | null;
      soap_plan?: string | null;
    } | null;
  } | null;
};

export type ScheduleDayOfflinePanelProps = {
  offlineStatus: ScheduleDayOfflineStatusViewModel;
  manualSyncPending: boolean;
  onManualSync: () => void;
  syncConflicts: ScheduleDaySyncConflictItem[];
  overwriteConflictPending: boolean;
  discardConflictPending: boolean;
  onOverwriteConflict: (itemId: number) => void;
  onDiscardConflict: (itemId: number) => void;
  cachedVisitBriefs: CachedVisitBriefCard[];
};

export function ScheduleDayOfflinePanel({
  offlineStatus,
  manualSyncPending,
  onManualSync,
  syncConflicts,
  overwriteConflictPending,
  discardConflictPending,
  onOverwriteConflict,
  onDiscardConflict,
  cachedVisitBriefs,
}: ScheduleDayOfflinePanelProps) {
  if (!offlineStatus.visible) return null;

  const manualSyncDisabledHintId = 'schedule-day-manual-sync-disabled-reason';
  const manualSyncDisabled =
    manualSyncPending ||
    !offlineStatus.canManualSync ||
    Boolean(offlineStatus.manualSyncDisabledReason);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">モバイル訪問モード</CardTitle>
          <CardDescription>オフライン巡回・帰局後同期の状態を確認します</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {offlineStatus.networkBadgeLabel}、{offlineStatus.pendingSyncLabel}、
            {offlineStatus.conflictLabel}、最終同期 {offlineStatus.lastSyncLabel}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className={offlineStatus.networkBadgeClassName}>
              {offlineStatus.networkBadgeLabel}
            </Badge>
            <Badge variant="outline">{offlineStatus.pendingSyncLabel}</Badge>
            <Badge variant="outline">{offlineStatus.conflictLabel}</Badge>
            <Badge variant="outline">{offlineStatus.ttlLabel}</Badge>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">朝の事前同期</p>
            <p className="mt-1">
              当日訪問予定の軽量 brief を端末へ保持し、患者サマリー / 前回課題 / 持参チェック対象を
              read-only で参照できます。
            </p>
            <p className="mt-1">最終同期: {offlineStatus.lastSyncLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onManualSync}
              disabled={manualSyncDisabled}
              aria-describedby={
                offlineStatus.manualSyncDisabledReason ? manualSyncDisabledHintId : undefined
              }
            >
              {manualSyncPending ? '同期中...' : '今すぐ同期'}
            </Button>
            {offlineStatus.manualSyncDisabledReason && (
              <span id={manualSyncDisabledHintId} className="text-xs text-muted-foreground">
                {offlineStatus.manualSyncDisabledReason}
              </span>
            )}
            {offlineStatus.showConflictResolutionHint && (
              <span className="text-xs text-amber-700">409 競合は下のカードで解決します</span>
            )}
          </div>
          {syncConflicts.length > 0 ? (
            <div className="space-y-3">
              {syncConflicts.map((item, index) => (
                <SyncConflictCard
                  key={item.id ?? `missing-id-${index}`}
                  item={item}
                  overwriteConflictPending={overwriteConflictPending}
                  discardConflictPending={discardConflictPending}
                  onOverwriteConflict={onOverwriteConflict}
                  onDiscardConflict={onDiscardConflict}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">競合している下書きはありません。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle id="schedule-day-cached-briefs-heading" className="text-base">
            軽量訪問ブリーフ
          </CardTitle>
          <CardDescription>
            重要情報だけを端末へ AES-GCM で暗号化して保存し、オフライン時は read-only で表示します
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {cachedVisitBriefs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              この日の軽量 brief キャッシュはまだありません。
            </p>
          ) : (
            <ul aria-labelledby="schedule-day-cached-briefs-heading" className="space-y-3">
              {cachedVisitBriefs.map((item) => (
                <CachedVisitBrief key={item.scheduleId} item={item} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SyncConflictCard({
  item,
  overwriteConflictPending,
  discardConflictPending,
  onOverwriteConflict,
  onDiscardConflict,
}: {
  item: ScheduleDaySyncConflictItem;
  overwriteConflictPending: boolean;
  discardConflictPending: boolean;
  onOverwriteConflict: (itemId: number) => void;
  onDiscardConflict: (itemId: number) => void;
}) {
  const [confirmingAction, setConfirmingAction] = useState<'overwrite' | 'discard' | null>(null);
  const hasConflictId = typeof item.id === 'number';
  const actionPending = overwriteConflictPending || discardConflictPending;
  const targetLabel = `schedule ${item.scope_id ?? '不明'}`;
  const actionUnavailable = !hasConflictId || actionPending;
  const localOutcome = String(item.conflict?.local.outcome_status ?? '未設定');
  const localPlan = String(item.conflict?.local.soap_plan ?? 'P未入力');
  const serverOutcome = item.conflict?.server?.outcome_status ?? '未設定';
  const serverPlan = item.conflict?.server?.soap_plan ?? 'P未入力';
  const confirmTitle =
    confirmingAction === 'overwrite'
      ? 'ローカル下書きでサーバー版を上書きします'
      : 'ローカル下書きを破棄してサーバー版を残します';

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">訪問記録の競合</p>
          <p className="mt-1 text-xs text-amber-800/90">
            {targetLabel} / {item.lastError ?? '競合あり'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => setConfirmingAction('overwrite')}
            disabled={actionUnavailable}
            aria-label={`${targetLabel} をサーバーへ上書き`}
          >
            上書き
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmingAction('discard')}
            disabled={actionUnavailable}
            aria-label={`${targetLabel} のローカル下書きを破棄`}
          >
            破棄
          </Button>
          {item.scope_id && (
            <Link
              href={`/visits/${item.scope_id}/record`}
              aria-disabled={actionPending}
              aria-label={`${targetLabel} を再編集`}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'border-amber-300 bg-white/50 hover:bg-white/80',
                actionPending && 'pointer-events-none opacity-50',
              )}
              onClick={(event) => {
                if (actionPending) event.preventDefault();
              }}
            >
              再編集
            </Link>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">ローカル下書き</p>
          <p className="mt-1 text-xs text-amber-800/90">結果 {localOutcome}</p>
          <p className="mt-1 text-xs leading-5 text-amber-800/90">{localPlan}</p>
        </div>
        <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
          <p className="text-xs font-medium text-amber-900">サーバー版</p>
          <p className="mt-1 text-xs text-amber-800/90">結果 {serverOutcome}</p>
          <p className="mt-1 text-xs leading-5 text-amber-800/90">{serverPlan}</p>
        </div>
      </div>
      {confirmingAction ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-white/80 px-3 py-3">
          <p className="text-sm font-medium text-amber-950">{confirmTitle}</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            ローカル下書き: {localOutcome} / {localPlan}、サーバー版: {serverOutcome} / {serverPlan}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={confirmingAction === 'discard' ? 'destructive' : 'default'}
              disabled={!hasConflictId || actionPending}
              onClick={() => {
                if (!hasConflictId) return;
                if (confirmingAction === 'overwrite') {
                  onOverwriteConflict(item.id as number);
                } else {
                  onDiscardConflict(item.id as number);
                }
                setConfirmingAction(null);
              }}
            >
              {confirmingAction === 'overwrite' ? '上書きを確定' : '破棄を確定'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={actionPending}
              onClick={() => setConfirmingAction(null)}
            >
              キャンセル
            </Button>
          </div>
        </div>
      ) : null}
      {!hasConflictId ? (
        <p className="mt-3 text-xs text-amber-800">
          競合IDを確認できないため、同期状態を再読み込みしてください。
        </p>
      ) : null}
    </div>
  );
}

function CachedVisitBrief({ item }: { item: CachedVisitBriefCard }) {
  return (
    <li className="rounded-xl border border-border px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-foreground">{item.patientName}</h3>
          <p className="text-xs text-muted-foreground">
            {timeLabel(item.timeWindowStart, item.timeWindowEnd)}
            {item.siteName ? ` / ${item.siteName}` : ''}
            {item.facilityLabel ? ` / ${item.facilityLabel}` : ''}
          </p>
        </div>
        <Badge variant={item.provider === 'openai' ? 'default' : 'outline'}>
          {item.provider === 'openai' && !item.isFallback ? 'AI生成' : 'ルール生成'}
        </Badge>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-900">{item.headline}</p>
      {item.mustCheckToday.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {item.mustCheckToday.slice(0, 3).map((check) => (
            <li key={check}>- {check}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        生成 {format(parseISO(item.generatedAt), 'M/d HH:mm', { locale: ja })} / 根拠{' '}
        {item.sourceRefs.join(' / ')}
      </p>
    </li>
  );
}
