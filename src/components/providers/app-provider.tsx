'use client';

import { useEffect, useRef } from 'react';
import { SessionProvider, useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import { QueryProvider } from '@/components/providers/query-provider';
import { OfflineSyncBridge } from '@/components/providers/offline-sync-bridge';
import { useAuthStore } from '@/lib/stores/auth-store';
import { clearOfflineEncryptionKey, initOfflineEncryptionKey } from '@/lib/offline/crypto';

type AppProviderProps = {
  children: React.ReactNode;
  session: Session | null;
  initialOrgId: string | null;
  initialSiteId: string | null;
};

function SessionStateBridge() {
  const { data: session, status } = useSession();
  const lastOfflineKeyRef = useRef<string | null>(null);

  useEffect(() => {
    useAuthStore.setState((state) => ({
      ...state,
      currentUser: {
        id: session?.user?.id ?? null,
        email: session?.user?.email ?? null,
        name: session?.user?.name ?? null,
        cognitoSub: session?.user?.cognitoSub ?? null,
        role: session?.user?.role ?? null,
      },
    }));
  }, [
    session?.user?.cognitoSub,
    session?.user?.email,
    session?.user?.id,
    session?.user?.name,
    session?.user?.role,
  ]);

  useEffect(() => {
    if (status === 'loading') return;

    const offlineIdentity = session?.user?.cognitoSub ?? session?.user?.id ?? null;
    if (offlineIdentity && lastOfflineKeyRef.current !== offlineIdentity) {
      lastOfflineKeyRef.current = offlineIdentity;
      void initOfflineEncryptionKey(offlineIdentity);
      return;
    }

    if (!offlineIdentity) {
      lastOfflineKeyRef.current = null;
      void clearOfflineEncryptionKey();
    }
  }, [session?.user?.cognitoSub, session?.user?.id, status]);

  return null;
}

export function AppProvider({ children, session, initialOrgId, initialSiteId }: AppProviderProps) {
  useEffect(() => {
    useAuthStore.setState({
      orgId: initialOrgId,
      siteId: initialSiteId,
    });
  }, [initialOrgId, initialSiteId]);

  return (
    <SessionProvider session={session}>
      <SessionStateBridge />
      <OfflineSyncBridge />
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
