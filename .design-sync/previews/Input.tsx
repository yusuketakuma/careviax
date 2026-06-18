import { Input, Label } from 'ph-os';

export function Default() {
  return (
    <div style={{ padding: 20, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor="patient-name">患者氏名</Label>
      <Input id="patient-name" defaultValue="田中 一郎" placeholder="氏名を入力" />
    </div>
  );
}

export function WithPlaceholder() {
  return (
    <div style={{ padding: 20, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor="insurance-number">保険者番号</Label>
      <Input id="insurance-number" inputMode="numeric" placeholder="8桁の数字を入力" />
    </div>
  );
}

export function States() {
  return (
    <div style={{ padding: 20, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label htmlFor="visit-addr">訪問先住所</Label>
        <Input id="visit-addr" defaultValue="東京都千代田区神田 1-2-3" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label htmlFor="disabled-field">担当薬剤師</Label>
        <Input id="disabled-field" defaultValue="佐藤 花子（変更不可）" disabled />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label htmlFor="invalid-field">処方箋受付番号</Label>
        <Input id="invalid-field" defaultValue="RX-00" aria-invalid />
      </div>
    </div>
  );
}
