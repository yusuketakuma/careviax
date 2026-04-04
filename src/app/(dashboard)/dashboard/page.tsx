import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { DashboardContent } from './dashboard-content';
import { DashboardSectionGroup } from './dashboard-section-group';
import { DeviceSupportMatrix } from './device-support-matrix';
import { OnboardingChecklist } from './onboarding-checklist';
import { OnboardingDismissable, OnboardingRestoreLink } from './onboarding-dismissable';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { DASHBOARD_HEADER_SHORTCUTS } from '@/lib/dashboard/home-config';
import { PageScaffold } from '@/components/layout/page-scaffold';

export default function DashboardPage() {
  return (
    <div>
      <div className="border-b border-border px-6 py-4">
        <WorkflowPageHeader
          className="mb-0 space-y-0"
          eyebrow="Daily Operations Hub"
          title="CareViaX — ダッシュボード"
          description="在宅訪問薬局業務・連携プラットフォーム"
          supportingContent={
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium text-foreground">最初に把握すること</p>
                <OnboardingRestoreLink />
              </div>
              <p className="text-sm text-muted-foreground">
                今日の全体状況、自分の予定、優先タスク、中核フローごとの滞留件数をここから確認します。
              </p>
            </div>
          }
          childrenLabel="主要導線"
        >
          <PageShortcutLinks links={DASHBOARD_HEADER_SHORTCUTS} />
        </WorkflowPageHeader>
      </div>
      <PageScaffold variant="bare">
        <OnboardingDismissable>
          <OnboardingChecklist />
        </OnboardingDismissable>
        <DashboardContent />
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
