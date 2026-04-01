import { DashboardContent } from './dashboard-content';
import { DeviceSupportMatrix } from './device-support-matrix';
import { OnboardingChecklist } from './onboarding-checklist';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';

export default function DashboardPage() {
  return (
    <div>
      <div className="border-b border-border px-6 py-4">
        <WorkflowPageHeader
          className="mb-0 space-y-0"
          title="CareViaX — ダッシュボード"
          description="在宅訪問薬局業務・連携プラットフォーム"
        />
      </div>
      <div className="space-y-6 p-6">
        <OnboardingChecklist />
        <DashboardContent />
        <DeviceSupportMatrix />
      </div>
    </div>
  );
}
