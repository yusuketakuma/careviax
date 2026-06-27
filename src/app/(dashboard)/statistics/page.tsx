import { type Metadata } from 'next';
import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { hasPermission, type PermissionKey } from '@/lib/auth/permissions';
import { ErrorState } from '@/components/ui/error-state';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { StatisticsContent } from './statistics-content';
import {
  STATISTICS_SURFACES,
  canEnterStatisticsHub,
  filterStatisticsSurfaces,
} from './statistics-surfaces';

export const metadata: Metadata = {
  title: '統計 — PH-OS',
};

async function resolveCurrentRole() {
  const session = await auth();
  const resolvedUser = await resolveLocalUserByIdentity({
    cognitoSub: session?.user?.cognitoSub,
    email: session?.user?.email,
  });
  const userId = session?.user?.id ?? resolvedUser?.id ?? null;
  const orgId = session?.user?.orgId ?? resolvedUser?.org_id ?? null;
  if (!userId || !orgId) return null;

  const membership = await prisma.membership.findFirst({
    where: { user_id: userId, org_id: orgId, is_active: true },
    select: { role: true },
  });
  return membership?.role ?? null;
}

export default async function StatisticsPage() {
  const role = await resolveCurrentRole();
  const can = (permission: PermissionKey) => (role ? hasPermission(role, permission) : false);

  return (
    <PageScaffold>
      <WorkflowPageHeader
        title="統計"
        description="システム内の統計情報を種別ごとに集約。各カードから詳細画面に移動できます（表示は権限に従います）。"
      />

      {canEnterStatisticsHub(can) ? (
        <StatisticsContent surfaces={filterStatisticsSurfaces(STATISTICS_SURFACES, can)} />
      ) : (
        <ErrorState
          variant="forbidden"
          size="page"
          title="統計を表示する権限がありません"
          description="ダッシュボードの閲覧権限が必要です。組織またはロールの権限設定をご確認ください。"
        />
      )}
    </PageScaffold>
  );
}
