'use client';

import { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { NavigationConfirmProvider } from '@/components/providers/navigation-confirm-provider';
import { Toaster } from '@/components/ui/sonner';
import { OFFLINE_CACHE_TTL_MS } from '@/lib/offline/cache-policy';

export async function pruneExpiredOfflineVisitBriefCache(now = Date.now()) {
  const { offlineDb } = await import('@/lib/stores/offline-db');
  const cutoff = new Date(now - OFFLINE_CACHE_TTL_MS);

  await offlineDb.visitBriefCache.where('updatedAt').below(cutoff).delete();
}

function OfflineCacheBootstrap() {
  useEffect(() => {
    void pruneExpiredOfflineVisitBriefCache().catch((error) => {
      console.warn('Failed to prune expired offline visit brief cache', error);
    });
  }, []);

  return null;
}

type RootProviderProps = {
  children: React.ReactNode;
  /** CSP nonce forwarded from middleware via the x-nonce request header. */
  nonce?: string;
};

export function RootProvider({ children, nonce }: RootProviderProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <OfflineCacheBootstrap />
      <NavigationConfirmProvider />
      {children}
      <Toaster position="top-right" />
    </ThemeProvider>
  );
}
