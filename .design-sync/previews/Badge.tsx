import { Badge } from 'ph-os';

export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <Badge variant="default">訪問予定</Badge>
      <Badge variant="secondary">在宅</Badge>
      <Badge variant="outline">要介護3</Badge>
      <Badge variant="destructive">疑義照会</Badge>
      <Badge variant="ghost">下書き</Badge>
      <Badge variant="link">処方詳細</Badge>
    </div>
  );
}

export function ClinicalTags() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <Badge variant="destructive">麻薬</Badge>
      <Badge variant="destructive">ハイリスク薬</Badge>
      <Badge variant="secondary">後発品</Badge>
      <Badge variant="outline">一包化</Badge>
      <Badge variant="default">居宅療養管理指導</Badge>
    </div>
  );
}

export function CountBadges() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <Badge variant="default">未処理 12</Badge>
      <Badge variant="destructive">期限超過 3</Badge>
      <Badge variant="secondary">残薬調整 5</Badge>
    </div>
  );
}
