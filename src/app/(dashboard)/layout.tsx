import { AppShell } from '@/components/layout/app-shell';
import { AppProvider } from '@/components/providers/app-provider';
import { auth } from '@/lib/auth/config';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { forbidden, unauthorized } from 'next/navigation';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.email && !session?.user?.cognitoSub) {
    unauthorized();
  }

  const localUser = await resolveLocalUserByIdentity({
    cognitoSub: session?.user?.cognitoSub,
    email: session?.user?.email,
  });
  const orgId = localUser?.org_id;
  if (!orgId) {
    forbidden();
  }
  const siteId = localUser?.default_site_id ?? null;

  return (
    <AppProvider
      session={session}
      initialOrgId={orgId}
      initialSiteId={siteId}
    >
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
