import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'KPI分析 — CareViaX',
};

export default function AnalyticsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          KPI分析ダッシュボード
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          訪問薬剤管理の主要KPIと分析レポート
        </p>
      </div>

      {/* Phase 3 placeholder banner */}
      <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="text-sm font-medium text-blue-800">
          Phase 3で詳細分析機能を実装予定
        </p>
        <p className="mt-1 text-sm text-blue-700">
          本画面はPhase 3で実装されます。Phase 2安定稼働1ヶ月以上を条件に着手します。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* 月間訪問件数推移 */}
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">月間訪問件数推移</h2>
          <div className="flex h-40 items-center justify-center rounded bg-muted">
            <p className="text-sm text-muted-foreground">グラフはPhase 3で実装</p>
          </div>
        </div>

        {/* 患者数推移 */}
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">患者数推移</h2>
          <div className="flex h-40 items-center justify-center rounded bg-muted">
            <p className="text-sm text-muted-foreground">グラフはPhase 3で実装</p>
          </div>
        </div>

        {/* 平均訪問時間 */}
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">平均訪問時間</h2>
          <div className="flex h-40 items-center justify-center rounded bg-muted">
            <p className="text-sm text-muted-foreground">グラフはPhase 3で実装</p>
          </div>
        </div>

        {/* 算定率 */}
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">算定率</h2>
          <div className="flex h-40 items-center justify-center rounded bg-muted">
            <p className="text-sm text-muted-foreground">グラフはPhase 3で実装</p>
          </div>
        </div>
      </div>
    </div>
  );
}
