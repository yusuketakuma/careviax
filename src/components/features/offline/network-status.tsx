'use client';

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Displays a banner when the browser goes offline.
 * Uses navigator.onLine and the online/offline events.
 */
export function NetworkStatus() {
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed left-0 right-0 top-0 z-50 flex items-center justify-center gap-2',
        'bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground',
        'animate-in slide-in-from-top duration-300'
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>オフライン — 読取専用モード</span>
    </div>
  );
}
