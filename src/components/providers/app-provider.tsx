'use client';

import { useEffect, useRef } from 'react';
import { SessionProvider, useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import { QueryProvider } from '@/components/providers/query-provider';
import { useAuthStore } from '@/lib/stores/auth-store';
import {
  clearOfflineEncryptionKey,
  initOfflineEncryptionKey,
} from '@/lib/offline/crypto';

type AppProviderProps = {
  children: React.ReactNode;
  session: Session | null;
  initialOrgId: string | null;
  initialSiteId: string | null;
};

function SessionStateBridge() {
  const { data: session, status } = useSession();
  const lastOfflineIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    useAuthStore.setState((state) => ({
      ...state,
      currentUser: {
        id: session?.user?.id ?? null,
        email: session?.user?.email ?? null,
        name: session?.user?.name ?? null,
        cognitoSub: session?.user?.cognitoSub ?? null,
      },
    }));
  }, [session?.user?.cognitoSub, session?.user?.email, session?.user?.id, session?.user?.name]);

  useEffect(() => {
    if (status === 'loading') return;

    const offlineIdentity = session?.user?.cognitoSub ?? session?.user?.id ?? null;
    if (offlineIdentity && lastOfflineIdentityRef.current !== offlineIdentity) {
      lastOfflineIdentityRef.current = offlineIdentity;
      void initOfflineEncryptionKey(offlineIdentity);
      return;
    }

    if (!offlineIdentity) {
      lastOfflineIdentityRef.current = null;
      void clearOfflineEncryptionKey();
    }
  }, [session?.user?.cognitoSub, session?.user?.id, status]);

  return null;
}

export function AppProvider({
  children,
  session,
  initialOrgId,
  initialSiteId,
}: AppProviderProps) {
  const initializedRef = useRef(false);

  if (!initializedRef.current) {
    useAuthStore.setState({
      orgId: initialOrgId,
      siteId: initialSiteId,
      currentUser: {
        id: session?.user?.id ?? null,
        email: session?.user?.email ?? null,
        name: session?.user?.name ?? null,
        cognitoSub: session?.user?.cognitoSub ?? null,
      },
    });
    initializedRef.current = true;
  }

  return (
    <SessionProvider session={session}>
      <SessionStateBridge />
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
