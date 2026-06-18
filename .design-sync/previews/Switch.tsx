import { Switch, Label } from 'ph-os';

export function Default() {
  return (
    <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
      <Switch checked aria-label="一包化を有効にする" />
      <Label>一包化を有効にする</Label>
    </div>
  );
}

export function States() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch checked aria-label="通知ON" />
        <Label>訪問リマインダー通知（オン）</Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch checked={false} aria-label="通知OFF" />
        <Label>残薬アラート（オフ）</Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Switch checked disabled aria-label="必須項目" />
        <Label>監査ログ記録（必須・変更不可）</Label>
      </div>
    </div>
  );
}

export function SettingsRow() {
  return (
    <div style={{ padding: 20, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>後発品への変更を許可</p>
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>
            処方医の指示がある場合は無効化されます
          </p>
        </div>
        <Switch checked aria-label="後発品変更を許可" />
      </div>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>夜間の緊急連絡を受け付ける</p>
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: '2px 0 0' }}>
            22:00〜翌6:00 の着信を担当者へ転送
          </p>
        </div>
        <Switch checked={false} aria-label="夜間連絡" />
      </div>
    </div>
  );
}
