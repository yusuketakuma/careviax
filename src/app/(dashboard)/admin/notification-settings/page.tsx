import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '通知設定 — CareViaX',
};

export default function NotificationSettingsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          通知チャネル設定
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          各通知チャネルの有効/無効を管理します
        </p>
      </div>

      <div className="max-w-xl space-y-4">
        {/* Email (SES) — 実装済み */}
        <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">メール (SES)</p>
            <p className="text-xs text-muted-foreground">Amazon SES経由でメール通知を送信</p>
          </div>
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            実装済み
          </span>
        </div>

        {/* LINE — Phase 3 */}
        <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 opacity-60">
          <div>
            <p className="text-sm font-medium text-foreground">LINE</p>
            <p className="text-xs text-muted-foreground">LINE Messaging API経由で通知を送信</p>
          </div>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            Phase 3で実装
          </span>
        </div>

        {/* SMS — Phase 3 */}
        <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 opacity-60">
          <div>
            <p className="text-sm font-medium text-foreground">SMS</p>
            <p className="text-xs text-muted-foreground">Amazon SNS経由でSMS通知を送信</p>
          </div>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            Phase 3で実装
          </span>
        </div>
      </div>
    </div>
  );
}
