import { Separator } from 'ph-os';

export function Horizontal() {
  return (
    <div style={{ padding: 24, maxWidth: 420 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>服薬指導記録</div>
      <Separator />
      <div style={{ fontSize: 13, color: '#475569', marginTop: 8 }}>
        次回訪問時に残薬を確認し、用法を再指導する。
      </div>
    </div>
  );
}

export function Vertical() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: 28,
        padding: 24,
        fontSize: 13,
        color: '#334155',
      }}
    >
      <span>担当: 佐藤 薬剤師</span>
      <Separator orientation="vertical" />
      <span>要介護度3</span>
      <Separator orientation="vertical" />
      <span>訪問日 6/18</span>
    </div>
  );
}
