import { Textarea, Label } from 'ph-os';

export function Default() {
  return (
    <div style={{ padding: 20, maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor="instruction-note">服薬指導メモ</Label>
      <Textarea
        id="instruction-note"
        rows={4}
        defaultValue="嚥下困難の訴えあり。一包化を継続し、朝食後の降圧剤は別包とする。次回訪問時に残薬を再確認。"
      />
    </div>
  );
}

export function WithPlaceholder() {
  return (
    <div style={{ padding: 20, maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Label htmlFor="packaging-note">配薬特記事項</Label>
      <Textarea id="packaging-note" rows={4} placeholder="朝だけ別包、食前薬はクリップ留めなど" />
    </div>
  );
}

export function States() {
  return (
    <div style={{ padding: 20, maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label htmlFor="ta-disabled">前回訪問記録（編集不可）</Label>
        <Textarea
          id="ta-disabled"
          rows={3}
          disabled
          defaultValue="血圧 138/86、服薬遵守良好。残薬3日分を確認し回収。"
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Label htmlFor="ta-invalid">疑義照会の内容</Label>
        <Textarea id="ta-invalid" rows={3} aria-invalid placeholder="照会内容は必須です" />
      </div>
    </div>
  );
}
