import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { DashboardContent } from './dashboard-content';
import { resolveDashboardFocusRole } from './dashboard-role-focus';
import { PageScaffold } from '@/components/layout/page-scaffold';

async function getDashboardFocusRole() {
  const session = await auth();
  const resolvedUser = await resolveLocalUserByIdentity({
    cognitoSub: session?.user?.cognitoSub,
    email: session?.user?.email,
  });
  const userId = session?.user?.id ?? resolvedUser?.id ?? null;
  const orgId = session?.user?.orgId ?? resolvedUser?.org_id ?? null;

  if (!userId || !orgId) {
    return resolveDashboardFocusRole(null);
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: userId, org_id: orgId, is_active: true },
    select: { role: true },
  });

  return resolveDashboardFocusRole(membership?.role ?? null);
}

/**
 * /dashboard。ビューポート最上部は new_01_dashboard の運用コックピット
 * (DashboardContent 先頭の DashboardCockpit)。
 */
export default async function DashboardPage() {
  const focusRole = await getDashboardFocusRole();

  return (
    <PageScaffold variant="bare">
      <DashboardContent focusRole={focusRole} />
    </PageScaffold>
  );
}
