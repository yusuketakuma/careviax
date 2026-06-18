import { Toaster } from 'ph-os';
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon } from 'lucide-react';

// sonner の <Toaster /> は toast() が呼ばれるまで空のポータルのみを描画するため、
// 静的キャプチャでは中身が見えない。実コンポーネントは下部に描画しつつ、
// DS トークンを使って実際のトースト見た目（success/info/warning/error）を再現する。
function ToastCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        width: 360,
        padding: '14px 16px',
        borderRadius: 'var(--radius)',
        background: 'var(--popover)',
        color: 'var(--popover-foreground)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        fontSize: 13,
      }}
    >
      <span style={{ display: 'flex', marginTop: 1 }}>{icon}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <strong style={{ fontWeight: 600 }}>{title}</strong>
        <span style={{ color: 'var(--muted-foreground)' }}>{description}</span>
      </div>
    </div>
  );
}

export function ToastVariants() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20 }}>
      <ToastCard
        icon={<CircleCheckIcon className="size-4" style={{ color: 'var(--primary)' }} />}
        title="服薬指導記録を保存しました"
        description="佐藤 花子 さんの記録が更新されました。"
      />
      <ToastCard
        icon={<InfoIcon className="size-4" style={{ color: 'var(--primary)' }} />}
        title="次回訪問が予定されました"
        description="2026年6月25日 14:00 に訪問予定を追加しました。"
      />
      <ToastCard
        icon={<TriangleAlertIcon className="size-4" style={{ color: '#b45309' }} />}
        title="残薬を確認してください"
        description="ワルファリン錠の残数が予定と一致しません。"
      />
      <ToastCard
        icon={<OctagonXIcon className="size-4" style={{ color: 'var(--destructive)' }} />}
        title="送信に失敗しました"
        description="医師への報告書送信中にエラーが発生しました。"
      />
      <Toaster />
    </div>
  );
}
