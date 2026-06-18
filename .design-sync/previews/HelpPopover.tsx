import { HelpPopover } from 'ph-os';

// HelpPopover renders a "?" trigger button; the panel is opened on
// click/hover (useState-driven) so it renders CLOSED by default in a
// static card. We show the trigger inline next to a realistic field
// label, which is its real usage pattern across the app.

export function Trigger() {
  return (
    <div style={{ padding: 32, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)' }}>要介護度</span>
      <HelpPopover
        title="要介護度について"
        description="介護保険の認定区分です。要支援1〜2、要介護1〜5の7段階で判定されます。"
      />
    </div>
  );
}

export function InlineWithLabel() {
  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 360 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)' }}>残薬調整</span>
        <HelpPopover
          title="残薬調整について"
          description="前回処方の飲み残しを確認し、今回の調剤数量を調整します。疑義照会が必要な場合は記録してください。"
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)' }}>一包化</span>
        <HelpPopover
          title="一包化について"
          description="複数の薬剤を服用タイミングごとにまとめて包装します。嚥下困難や服薬管理が難しい患者に適用します。"
        />
      </div>
    </div>
  );
}
