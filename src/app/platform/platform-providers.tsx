'use client';

import type { ReactNode } from 'react';
import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import { QueryProvider } from '@/components/providers/query-provider';

/**
 * Lightweight provider stack for `/platform`. `AppProvider` (used by the
 * tenant `(dashboard)`) is org-scoped (`initialOrgId`/`initialSiteId`,
 * offline PHI sync bridge) and does not apply to a platform operator, who has
 * no org membership. This wraps only what the platform console needs:
 * next-auth session context (for step-up re-auth / sign-out) + react-query.
 */
export function PlatformProviders({
  children,
  session,
}: {
  children: ReactNode;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
