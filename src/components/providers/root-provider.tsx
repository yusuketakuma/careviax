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

export function RootProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeStoreBridge />
      <OfflineCacheBootstrap />
      {children}
      <Toaster position="top-right" />
    </ThemeProvider>
  );
}
