import { StateBadge } from 'ph-os';

export function Roles() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <StateBadge role="waiting" />
      <StateBadge role="confirm" />
      <StateBadge role="done" />
      <StateBadge role="blocked" />
      <StateBadge role="readonly" />
    </div>
  );
}

export function TagRoles() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <StateBadge role="hazard" />
      <StateBadge role="info" />
    </div>
  );
}

export function WorkflowLabels() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <StateBadge role="waiting">医師の確認待ち</StateBadge>
      <StateBadge role="confirm">疑義照会あり</StateBadge>
      <StateBadge role="done">服薬指導済み</StateBadge>
      <StateBadge role="blocked">残薬未確認</StateBadge>
    </div>
  );
}

export function WithoutIcon() {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 20 }}>
      <StateBadge role="done" showIcon={false}>
        報告書提出済み
      </StateBadge>
      <StateBadge role="waiting" showIcon={false}>
        承認待ち
      </StateBadge>
    </div>
  );
}
