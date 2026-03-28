import { DashboardContent } from './dashboard-content';
import { DeviceSupportMatrix } from './device-support-matrix';
import { OnboardingChecklist } from './onboarding-checklist';

export default function DashboardPage() {
  return (
    <div>
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          CareViaX — ダッシュボード
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          在宅訪問薬局業務・連携プラットフォーム
        </p>
      </div>
      <div className="space-y-6 p-6">
        <OnboardingChecklist />
        <DashboardContent />
        <DeviceSupportMatrix />
      </div>
    </div>
  );
}
