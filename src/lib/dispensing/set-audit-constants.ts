export const SET_AUDIT_CHECK_ITEMS = [
  { key: 'date_match', label: '日付が正しい' },
  { key: 'timing_match', label: '用法が正しい' },
  { key: 'quantity_match', label: '数量が正しい' },
  { key: 'no_discontinued', label: '中止薬が混入していない' },
  { key: 'residual_usage_ok', label: '残薬使用の指示と一致' },
  { key: 'cold_storage_separated', label: '冷所薬を分離している' },
] as const;

export type SetAuditChecklistKey = (typeof SET_AUDIT_CHECK_ITEMS)[number]['key'];

export const SET_AUDIT_REQUIRED_CHECKLIST_KEYS: readonly SetAuditChecklistKey[] =
  SET_AUDIT_CHECK_ITEMS.map((item) => item.key);

export const CARRY_PACKET_EVIDENCE_SCHEMA_VERSION = 1;

export const OUTSIDE_MED_EVIDENCE_KINDS = [
  'prn',
  'topical',
  'cold',
  'injection',
  'liquid',
  'other',
] as const;
export type OutsideMedEvidenceKind = (typeof OUTSIDE_MED_EVIDENCE_KINDS)[number];

export const CARRY_PACKET_ITEM_KEYS = ['cal', 'ton', 'gai', 'liq', 'doc', 'note'] as const;
export type CarryPacketItemKey = (typeof CARRY_PACKET_ITEM_KEYS)[number];

export interface CarryPacketEvidenceInput {
  schema_version: typeof CARRY_PACKET_EVIDENCE_SCHEMA_VERSION;
  plan_id: string;
  cycle_id: string;
  patient_id: string;
  outside_meds: Array<{
    line_id: string;
    kind: OutsideMedEvidenceKind;
    checked: true;
  }>;
  packet_items: Array<{
    key: CarryPacketItemKey;
    checked: true;
  }>;
  summary: {
    outside_required_count: number;
    outside_confirmed_count: number;
    packet_required_count: number;
    packet_confirmed_count: number;
    all_checked: true;
  };
}
