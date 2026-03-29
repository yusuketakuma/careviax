'use client';

import { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { useTheme } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { OFFLINE_CACHE_TTL_MS } from '@/lib/offline/cache-policy';
import { offlineDb } from '@/lib/stores/offline-db';
import { useUIStore } from '@/lib/stores/ui-store';

function ThemeStoreBridge() {
  const storedTheme = useUIStore((state) => state.theme);
  const setStoredTheme = useUIStore((state) => state.setTheme);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!storedTheme || theme === storedTheme) return;
    setTheme(storedTheme);
  }, [setTheme, storedTheme, theme]);

  useEffect(() => {
    if (!theme || theme === storedTheme) return;
    setStoredTheme(theme as 'light' | 'dark' | 'system');
  }, [setStoredTheme, storedTheme, theme]);

  return null;
}

function OfflineCacheBootstrap() {
  useEffect(() => {
    void (async () => {
      const cutoff = new Date(Date.now() - OFFLINE_CACHE_TTL_MS);
      await offlineDb.visitBriefCache.where('updatedAt').below(cutoff).delete();
    })();
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
      <ThemeStoreBridge />
      <OfflineCacheBootstrap />
      {children}
      <Toaster position="top-right" />
    </ThemeProvider>
  );
}
