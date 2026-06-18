import { Button } from 'ph-os';

export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <Button variant="default">保存する</Button>
      <Button variant="secondary">下書き保存</Button>
      <Button variant="outline">キャンセル</Button>
      <Button variant="ghost">編集</Button>
      <Button variant="destructive">削除</Button>
      <Button variant="link">詳細を見る</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <Button size="xs">XS</Button>
      <Button size="sm">小</Button>
      <Button size="default">標準</Button>
      <Button size="lg">大きい</Button>
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <Button>送信する</Button>
      <Button disabled>送信中…</Button>
      <Button variant="outline" disabled>無効</Button>
    </div>
  );
}
