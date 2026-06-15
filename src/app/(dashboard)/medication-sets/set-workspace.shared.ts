/**
 * new_09_set(訪問単位・施設グルーピングのセット準備ワークスペース)の共有語彙。
 * /api/medication-sets/workspace のレスポンス型と、
 * 事務先行セット工程の状態(完了/監査待ち/部分承認/差戻し/進行中/事務完了後)の表示マッピング。
 * docs/design-gap-analysis-new.md 09_set セクション準拠。
 */

export type SetWorkspaceScope = 'today' | 'upcoming';

export type SetSlotKey = 'morning' | 'noon' | 'evening';

/** 朝/昼/夕 スロットの充足: set=✓ / partial=・ / none=— */
export type SetSlotMark = 'set' | 'partial' | 'none';

/** 事務先行セットの行状態 */
export type SetRowStatusKey =
  | 'completed'
  | 'partial_approved'
  | 'rejected'
  | 'quantity_check'
  | 'in_progress'
  | 'waiting';

export type SetWorkspaceRow = {
  patient_id: string;
  patient_name: string;
  /** 居室番号(Residence.unit_name)。未登録は null = 「—」 */
  room_label: string | null;
  /** アレルギー登録あり(危険タグ・常時可視) */
  has_allergy: boolean;
  slots: Record<SetSlotKey, SetSlotMark>;
  status: SetRowStatusKey;
  /** 担当ラベル(例「鈴木(事務)」)。不明は null */
  assignee_label: string | null;
};

export type SetLaneCounts = {
  normal: number;
  cold: number;
  narcotic: number;
};

export type SetWorkspaceFacilityGroup = {
  facility_id: string;
  facility_name: string;
  /** 訪問時刻(ISO)。未確定は null */
  visit_time: string | null;
  rows: SetWorkspaceRow[];
  completed_count: number;
  total_count: number;
  lane_counts: SetLaneCounts;
  /** 「薬剤師の最終確認」行の担当(訪問担当薬剤師) */
  final_check_assignee: string | null;
};

export type SetPendingItem = {
  id: string;
  kind: 'audit_waiting' | 'preworkable';
  /** 監査待ち / 明日分 */
  badge_label: string;
  title: string;
  subtitle: string | null;
  /** 所要15分 / 余白で先行可(20分) */
  meta_label: string | null;
  action_label: string;
  action_href: string;
};

export type SetWorkspaceEvidence = {
  /** 配薬カート対応表の件数(施設グループ単位) */
  cart_map_count: number;
  /** 冷所温度ログの状態(開いている冷所系例外がなければ「正常」) */
  cold_storage_log_status: string;
};

export type SetWorkspaceResponse = {
  generated_at: string;
  scope: SetWorkspaceScope;
  facility_groups: SetWorkspaceFacilityGroup[];
  pending_items: SetPendingItem[];
  evidence: SetWorkspaceEvidence;
};

export type SetRowStatusPresentation = {
  label: string;
  /** 状態バッジ/テキストの配色(緑=完了 / 黄=確認中 / 青=進行中 / 灰=待機) */
  badgeClassName: string;
  /** 注意行の背景(監査待ち・再作業=薄い状態色) */
  rowClassName?: string;
};

export const SET_ROW_STATUS_PRESENTATIONS: Record<SetRowStatusKey, SetRowStatusPresentation> = {
  completed: {
    label: '完了',
    badgeClassName: 'bg-emerald-100 text-emerald-700',
  },
  partial_approved: {
    label: '部分承認',
    badgeClassName: 'bg-amber-100 text-amber-800',
    rowClassName: 'bg-amber-50/60 hover:bg-amber-50',
  },
  rejected: {
    label: '差戻し',
    badgeClassName: 'bg-red-100 text-red-700',
    rowClassName: 'bg-red-50/60 hover:bg-red-50',
  },
  quantity_check: {
    label: '監査待ち',
    badgeClassName: 'bg-amber-100 text-amber-800',
    rowClassName: 'bg-amber-50/60 hover:bg-amber-50',
  },
  in_progress: {
    label: '進行中',
    badgeClassName: 'bg-blue-100 text-blue-700',
  },
  waiting: {
    label: '着手前',
    badgeClassName: 'bg-slate-100 text-slate-600',
  },
};

export const SET_SLOT_MARKS: Record<SetSlotMark, string> = {
  set: '✓',
  partial: '・',
  none: '—',
};

/** 朝/昼/夕 セルの表示(例「✓/✓/—」) */
export function formatSlotMarks(slots: Record<SetSlotKey, SetSlotMark>): string {
  return [slots.morning, slots.noon, slots.evening].map((mark) => SET_SLOT_MARKS[mark]).join('/');
}
