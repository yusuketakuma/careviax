export const HIGH_RISK_KEYWORDS = [
  'ワーファリン',
  'インスリン',
  '麻薬',
  'ヘパリン',
  'リチウム',
  'ジゴキシン',
  'テオフィリン',
] as const;

export const CARRY_TYPE_LABELS: Record<string, string> = {
  carry: '持参',
  facility_deposit: '施設預け',
  deferred: '後日対応',
};

export const CARRY_TYPE_OPTIONS = [
  { value: 'carry', label: '持参' },
  { value: 'facility_deposit', label: '施設預け' },
  { value: 'deferred', label: '後日対応' },
] as const;
