import { StatusDot } from 'ph-os';

export function WithLabels() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', padding: 20 }}>
      <StatusDot role="waiting" showLabel label="他職種の確認待ち" />
      <StatusDot role="confirm" showLabel label="要確認（残薬あり）" />
      <StatusDot role="done" showLabel label="訪問完了" />
      <StatusDot role="blocked" showLabel label="処方未取得" />
      <StatusDot role="readonly" showLabel label="閲覧のみ" />
    </div>
  );
}

export function TagDots() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', padding: 20 }}>
      <StatusDot role="hazard" showLabel label="ハイリスク薬を含む" />
      <StatusDot role="info" showLabel label="補足情報あり" />
    </div>
  );
}

export function InlineWithText() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start', padding: 20, fontSize: 14 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <StatusDot role="done" label="完了" />
        田中 花子 様 ・ 5/12 訪問
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <StatusDot role="waiting" label="確認待ち" />
        佐藤 健一 様 ・ 疑義照会中
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <StatusDot role="blocked" label="保留" />
        鈴木 みどり 様 ・ 処方箋未着
      </span>
    </div>
  );
}
