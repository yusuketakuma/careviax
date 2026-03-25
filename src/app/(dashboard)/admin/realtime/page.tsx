import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'リアルタイム共有設定 — CareViaX',
};

export default function RealtimePage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          リアルタイム共有設定
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          訪問ステータスのリアルタイム更新とケアチーム間の情報共有設定
        </p>
      </div>

      {/* Phase 3 placeholder banner */}
      <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="text-sm font-medium text-blue-800">
          Phase 3で実装予定
        </p>
        <p className="mt-1 text-sm text-blue-700">
          本機能はPhase 3で実装されます。Phase 2安定稼働1ヶ月以上を条件に着手します。
        </p>
      </div>

      <div className="max-w-xl space-y-4">
        {/* 訪問ステータスのリアルタイム更新 */}
        <div className="rounded-md border border-border bg-card px-4 py-4 opacity-60">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">訪問ステータスのリアルタイム更新</p>
              <p className="mt-1 text-xs text-muted-foreground">
                訪問開始・完了・遅延などのステータス変更をチームメンバーにリアルタイム通知します。
                Server-Sent Events (SSE) を使用して実装予定です。
              </p>
            </div>
            <span className="ml-4 inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              Phase 3
            </span>
          </div>
        </div>

        {/* ケアチーム間の位置情報共有 */}
        <div className="rounded-md border border-border bg-card px-4 py-4 opacity-60">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">ケアチーム間の位置情報共有設定</p>
              <p className="mt-1 text-xs text-muted-foreground">
                訪問中の薬剤師の位置情報をケアチームと共有します。
                患者同意取得と個人情報保護の要件を満たした設計で実装予定です。
              </p>
            </div>
            <span className="ml-4 inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              Phase 3
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
