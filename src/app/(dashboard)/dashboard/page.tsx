import { auth } from '@/lib/auth/config';
import { memberRoleLabel } from '@/lib/auth/member-roles';
import { prisma } from '@/lib/db';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { DashboardContent } from './dashboard-content';
import { dashboardFocusSummary, resolveDashboardFocusRole } from './dashboard-role-focus';
import { DashboardSectionGroup } from './dashboard-section-group';
import { DeviceSupportMatrix } from './device-support-matrix';
import { OnboardingChecklist } from './onboarding-checklist';
import { OnboardingDismissable, OnboardingRestoreLink } from './onboarding-dismissable';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { DASHBOARD_HEADER_SHORTCUTS } from '@/lib/dashboard/home-config';
import { PageScaffold } from '@/components/layout/page-scaffold';

async function getDashboardViewer() {
  const session = await auth();
  const resolvedUser = await resolveLocalUserByIdentity({
    cognitoSub: session?.user?.cognitoSub,
    email: session?.user?.email,
  });
  const userId = session?.user?.id ?? resolvedUser?.id ?? null;
  const orgId = session?.user?.orgId ?? resolvedUser?.org_id ?? null;

  if (!userId || !orgId) {
    return {
      focusRole: resolveDashboardFocusRole(null),
      roleLabel: '共通導線',
    };
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: userId, org_id: orgId, is_active: true },
    select: { role: true },
  });

  return {
    focusRole: resolveDashboardFocusRole(membership?.role ?? null),
    roleLabel: membership?.role ? memberRoleLabel(membership.role) : '共通導線',
  };
}

export default async function DashboardPage() {
  const viewer = await getDashboardViewer();

  return (
    <div>
      <div className="border-b border-border px-6 py-4">
        <WorkflowPageHeader
          className="mb-0 space-y-0"
          eyebrow="Daily Operations Home"
          title="CareViaX ホーム"
          description={`今日の優先対応、予定、担当別の入口を最初に確認するための運用トップです。現在は ${viewer.roleLabel} 向けの見方を強調しています。`}
          supportingContent={
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium text-foreground">最初に把握すること</p>
                <OnboardingRestoreLink />
              </div>
              <p className="text-sm font-medium text-foreground">{dashboardFocusSummary(viewer.focusRole)}</p>
              <p className="text-sm text-muted-foreground">
                緊急対応、今日の予定、薬剤師と事務スタッフの担当入口、工程ごとの滞留をこの順で確認します。
              </p>
            </div>
          }
          childrenLabel="主要導線"
        >
          <PageShortcutLinks links={DASHBOARD_HEADER_SHORTCUTS} />
        </WorkflowPageHeader>
      </div>
      <PageScaffold variant="bare">
        <DashboardContent focusRole={viewer.focusRole} />
        <OnboardingDismissable>
          <OnboardingChecklist />
        </OnboardingDismissable>
        <DashboardSectionGroup
          id="dashboard-environment-guidance"
          eyebrow="Reference"
          title="利用環境の目安"
          description="主要業務の推奨端末を補足情報として分離し、日次オペレーションの情報と混ざらないようにしています。"
        >
          <DeviceSupportMatrix embedded />
        </DashboardSectionGroup>
      </PageScaffold>
    </div>
  );
}
