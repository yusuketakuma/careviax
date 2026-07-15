'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export type OfflineSyncStatus =
  | 'checking'
  | 'offline'
  | 'conflict'
  | 'failed'
  | 'syncing'
  | 'pending'
  | 'synced';

interface OfflineDraftIndicatorProps {
  status: OfflineSyncStatus;
  pendingCount?: number;
  lastSyncedLabel?: string | null;
}

export function OfflineDraftIndicator({
  status,
  pendingCount = 0,
  lastSyncedLabel,
}: OfflineDraftIndicatorProps) {
  const count = Math.max(0, pendingCount);
  const config = {
    checking: {
      label: '同期状況を確認中',
      ariaLabel: '同期状況を確認中 — 同期状況を開く',
      className: 'text-muted-foreground hover:bg-muted',
      icon: RefreshCw,
      iconClassName: 'motion-safe:animate-spin',
    },
    offline: {
      label: 'オフライン',
      ariaLabel: `オフライン${count > 0 ? `、同期待ち${count}件` : ''} — 同期状況を開く`,
      className: 'text-state-blocked hover:bg-state-blocked/10',
      icon: CloudOff,
      iconClassName: '',
    },
    conflict: {
      label: '競合あり',
      ariaLabel: `同期データに競合があります${count > 0 ? `、確認対象${count}件` : ''} — 同期状況を開く`,
      className: 'text-state-confirm hover:bg-state-confirm/10',
      icon: AlertTriangle,
      iconClassName: '',
    },
    failed: {
      label: '同期失敗',
      ariaLabel: `同期に失敗しました${count > 0 ? `、確認対象${count}件` : ''} — 同期状況を開く`,
      className: 'text-state-blocked hover:bg-state-blocked/10',
      icon: AlertTriangle,
      iconClassName: '',
    },
    syncing: {
      label: '同期中',
      ariaLabel: `同期中${count > 0 ? `、残り${count}件` : ''} — 同期状況を開く`,
      className: 'text-state-confirm hover:bg-state-confirm/10',
      icon: RefreshCw,
      iconClassName: 'motion-safe:animate-spin',
    },
    pending: {
      label: '同期待ち',
      ariaLabel: `同期待ち${count}件 — 同期状況を開く`,
      className: 'text-state-confirm hover:bg-state-confirm/10',
      icon: CloudOff,
      iconClassName: '',
    },
    synced: {
      label: '同期済み',
      ariaLabel: `同期済み${lastSyncedLabel ? `、最終成功${lastSyncedLabel}` : ''} — 同期状況を開く`,
      className: 'text-state-done hover:bg-state-done/10',
      icon: CheckCircle2,
      iconClassName: '',
    },
  } satisfies Record<
    OfflineSyncStatus,
    {
      label: string;
      ariaLabel: string;
      className: string;
      icon: typeof CheckCircle2;
      iconClassName: string;
    }
  >;
  const current = config[status];
  const Icon = current.icon;

  return (
    <Link
      href="/offline-sync"
      className={`hidden min-h-9 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[480px]:!hidden md:flex ${current.className}`}
      data-testid="app-header-sync-status"
      aria-live="polite"
      aria-label={current.ariaLabel}
    >
      <Icon className={`size-3.5 ${current.iconClassName}`} aria-hidden="true" />
      <span>{current.label}</span>
      {count > 0 && status !== 'synced' && status !== 'checking' ? (
        <Badge className="h-5 min-w-5 px-1 text-xs" aria-hidden="true">
          {count}
        </Badge>
      ) : null}
      {status === 'synced' && lastSyncedLabel ? (
        <span className="text-muted-foreground">最終成功 {lastSyncedLabel}</span>
      ) : null}
    </Link>
  );
}
