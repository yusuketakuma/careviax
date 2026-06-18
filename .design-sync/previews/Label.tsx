import { Label, Input } from 'ph-os';

export function WithInput() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 20, maxWidth: 360 }}>
      <Label htmlFor="patient-name">患者氏名</Label>
      <Input id="patient-name" defaultValue="佐藤 花子" />
    </div>
  );
}

export function Required() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 20, maxWidth: 360 }}>
      <Label htmlFor="visit-date">
        次回訪問日<span style={{ color: 'var(--destructive)' }}>必須</span>
      </Label>
      <Input id="visit-date" type="date" defaultValue="2026-06-25" />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="group" data-disabled="true" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 20, maxWidth: 360 }}>
      <Label htmlFor="insurer-no">保険者番号</Label>
      <Input id="insurer-no" defaultValue="01130012" disabled />
    </div>
  );
}
