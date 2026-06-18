import { Checkbox, Label } from 'ph-os';

export function Default() {
  return (
    <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox id="cb-consent" defaultChecked />
      <Label htmlFor="cb-consent">個人情報の取扱いに同意する</Label>
    </div>
  );
}

export function States() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id="cb-on" defaultChecked />
        <Label htmlFor="cb-on">残薬確認を実施した</Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id="cb-off" />
        <Label htmlFor="cb-off">服薬指導書を交付した</Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id="cb-disabled" defaultChecked disabled />
        <Label htmlFor="cb-disabled">医療券交付済み（変更不可）</Label>
      </div>
    </div>
  );
}

export function ChecklistGroup() {
  return (
    <div style={{ padding: 20, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--muted-foreground)' }}>
        訪問前チェックリスト
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id="ck-1" defaultChecked />
        <Label htmlFor="ck-1">処方箋を確認した</Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id="ck-2" defaultChecked />
        <Label htmlFor="ck-2">一包化セットを準備した</Label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox id="ck-3" />
        <Label htmlFor="ck-3">前回の残薬を回収予定</Label>
      </div>
    </div>
  );
}
