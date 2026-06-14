'use client';

import Link from 'next/link';
import { CloudOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Offline draft indicator component.
 *
 * Phase 2 placeholder: shows the number of pending sync items stored locally
 * via Dexie (IndexedDB). Full sync implementation will be added in the Phase 2
 * offline feature milestone.
 */
interface OfflineDraftIndicatorProps {
  /** Number of drafts pending sync */
  pendingCount?: number;
  /** Whether a sync operation is in progress */
  isSyncing?: boolean;
  /** Called when the user manually triggers a sync */
  onSync?: () => void;
}

export function OfflineDraftIndicator({
  pendingCount = 0,
  isSyncing = false,
  onSync,
}: OfflineDraftIndicatorProps) {
  if (pendingCount === 0 && !isSyncing) {
    return (
      <Link
        href="/offline-sync"
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-green-700 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="status"
        aria-live="polite"
        aria-label="同期済み — 同期状況を開く"
      >
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        同期済み
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <Link
        href="/offline-sync"
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-orange-700 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="同期待ち — 同期状況を開く"
      >
        <CloudOff className="size-3.5" aria-hidden="true" />
        <span>同期待ち</span>
        {pendingCount > 0 && (
          <Badge
            className="h-4 min-w-[1.25rem] px-1 text-[10px] bg-orange-600 hover:bg-orange-600"
            aria-label={`${pendingCount}件の同期待ちがあります`}
          >
            {pendingCount}
          </Badge>
        )}
      </Link>

      {onSync && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-orange-700 hover:bg-orange-50"
          onClick={onSync}
          disabled={isSyncing}
          aria-label="今すぐ同期"
        >
          <RefreshCw
            className={`mr-1 size-3 ${isSyncing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {isSyncing ? '同期中...' : '同期'}
        </Button>
      )}
    </div>
  );
}
