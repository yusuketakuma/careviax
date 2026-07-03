import type { ReactNode } from 'react';
import { forbidden, unauthorized } from 'next/navigation';
import { PlatformOperatorStatus } from '@prisma/client';
import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { PlatformProviders } from './platform-providers';
import { PlatformShell } from './platform-shell';

/**
 * `/platform` is an independent route segment outside `(dashboard)`: platform
 * operators are NOT tenant org members, so the `(dashboard)/layout.tsx` gate
 * (which requires `localUser.org_id`) would reject them. This layout instead
 * verifies an active `PlatformOperator` row for the signed-in user — the
 * platform-console equivalent of the dashboard's org-membership gate.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.email && !session?.user?.cognitoSub) {
    unauthorized();
  }

  const localUser = await resolveLocalUserByIdentity({
    cognitoSub: session?.user?.cognitoSub,
    email: session?.user?.email,
  });
  if (!localUser?.id) {
    forbidden();
  }

  const operator = await prisma.platformOperator.findUnique({
    where: { user_id: localUser.id },
    select: { role: true, status: true },
  });
  if (!operator || operator.status !== PlatformOperatorStatus.active) {
    forbidden();
  }

  return (
    <PlatformProviders session={session}>
      <PlatformShell operatorRole={operator.role}>{children}</PlatformShell>
    </PlatformProviders>
  );
}
