'use client';

import Link from 'next/link';
import { CloudOff } from 'lucide-react';
import { useNetworkOnline } from '@/lib/hooks/use-network-online';
import { OFFLINE_CACHE_TTL_HOURS } from '@/lib/offline/cache-policy';

export function NetworkStatusBanner() {
  const online = useNetworkOnline();

  if (online) {
    return null;
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-900 md:px-6">
      <div className="flex flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <CloudOff className="h-4 w-4" aria-hidden="true" />
          <p>
            ネットワーク接続が切れています。端末に保存済みの情報のみを read-only で表示します。キャッシュ保持は最長 {OFFLINE_CACHE_TTL_HOURS} 時間です。
          </p>
        </div>
        <Link href="/offline" className="font-medium underline underline-offset-4">
          オフライン時の案内を見る
        </Link>
      </div>
    </div>
  );
}
