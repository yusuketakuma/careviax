import { DashboardContent } from './dashboard-content';

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
      <DashboardContent />
    </div>
  );
}
