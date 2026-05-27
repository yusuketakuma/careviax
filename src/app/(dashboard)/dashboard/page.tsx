import { auth } from '@/lib/auth/config';
import { memberRoleLabel } from '@/lib/auth/member-roles';
import { prisma } from '@/lib/db';
import { resolveLocalUserByIdentity } from '@/lib/auth/user-resolution';
import { CalendarDays, ListChecks, UserRound } from 'lucide-react';
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
  const todayLabel = new Intl.DateTimeFormat('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());

  return (
    <div>
      <div className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(34,113,177,0.10),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_26%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] px-6 py-5">
        <WorkflowPageHeader
          className="mb-0 space-y-0"
          eyebrow="Daily Operations Home"
          title="PH-OS ホーム"
          description={`今日の優先対応、予定、担当別の入口を最初に確認するための運用トップです。現在は ${viewer.roleLabel} 向けの見方を強調しています。`}
          supportingContent={
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium text-foreground">最初に把握すること</p>
                  <OnboardingRestoreLink />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {dashboardFocusSummary(viewer.focusRole)}
                </p>
                <p className="text-sm text-muted-foreground">
                  緊急対応、今日の予定、職種ごとの初動を確認したあと、処方登録から報告書までの 8 工程を固定順で追えるようにしています。
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    今日
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">{todayLabel}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <UserRound className="size-3.5" aria-hidden="true" />
                    強調ロール
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">{viewer.roleLabel}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <ListChecks className="size-3.5" aria-hidden="true" />
                    確認順
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    緊急対応 → 予定 → 8工程
                  </p>
                </div>
              </div>
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
          tone="reference"
        >
          <DeviceSupportMatrix embedded />
        </DashboardSectionGroup>
      </PageScaffold>
    </div>
  );
}
