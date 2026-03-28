'use client';

import { useRef } from 'react';
import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';
import { QueryProvider } from '@/components/providers/query-provider';
import { useAuthStore } from '@/lib/stores/auth-store';

type AppProviderProps = {
  children: React.ReactNode;
  session: Session | null;
  initialOrgId: string | null;
  initialSiteId: string | null;
};

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
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
