/**
 * p0_06「詳しく絞り込む」モーダルで使う型・選択肢・初期値の定義。
 * UI と API 接続層を分離するため shared ファイルに集約。
 */

// ---------------------------------------------------------------------------
// AdvancedFilterState
// ---------------------------------------------------------------------------

export type AdvancedFilterState = {
  /** 訪問日プリセット。接続可 (/api/visit-schedules?date_from=&date_to=)。 */
  visitDateRange: VisitDateRangePreset | null;
  /** 担当薬剤師 ID。接続可 (/api/visit-schedules?pharmacist_id=)。 */
  assigneeId: string | null;
  /** 現在の工程(MedicationCycleStatus サブセット)。接続可 (/api/prescription-intakes?status=)。 */
  cycleStatus: CycleStatusOption | null;
  /** 注意ポイント。処方カード検索では /api/prescription-intakes?care_tags= に接続する。 */
  careTags: CareTag[];
  /** 予定の状態(VisitProposalStatus サブセット)。将来接続扱い。
   * 接続先: /api/visit-schedule-proposals?status= */
  proposalStatus: ProposalStatusOption | null;
  /** 薬切れ期間(日)。接続可 (/api/dashboard/medication-deadlines?within_days=)。 */
  medicationDeadlineWithinDays: MedicationDeadlineDays | null;
};

export const EMPTY_ADVANCED_FILTER: AdvancedFilterState = {
  visitDateRange: null,
  assigneeId: null,
  cycleStatus: null,
  careTags: [],
  proposalStatus: null,
  medicationDeadlineWithinDays: null,
};

// ---------------------------------------------------------------------------
// 訪問日プリセット
// ---------------------------------------------------------------------------

export type VisitDateRangePreset =
  | 'today_to_week'
  | 'today'
  | 'tomorrow'
  | 'this_week'
  | 'next_week';

export const VISIT_DATE_RANGE_OPTIONS: Array<{ value: VisitDateRangePreset; label: string }> = [
  { value: 'today_to_week', label: '今日〜今週' },
  { value: 'today', label: '今日' },
  { value: 'tomorrow', label: '明日' },
  { value: 'this_week', label: '今週' },
  { value: 'next_week', label: '来週' },
];

// ---------------------------------------------------------------------------
// 現在の工程(MedicationCycleStatus サブセット)
// ---------------------------------------------------------------------------

export type CycleStatusOption =
  | 'intake_received'
  | 'structuring'
  | 'inquiry_pending'
  | 'ready_to_dispense'
  | 'dispensing'
  | 'audit_pending'
  | 'setting'
  | 'set_audited'
  | 'visit_ready'
  | 'visit_completed'
  | 'reported'
  | 'on_hold';

export const CYCLE_STATUS_OPTIONS: Array<{ value: CycleStatusOption; label: string }> = [
  { value: 'intake_received', label: '受付済' },
  { value: 'structuring', label: '構造化中' },
  { value: 'inquiry_pending', label: '疑義照会中' },
  { value: 'ready_to_dispense', label: '調剤待ち' },
  { value: 'dispensing', label: '調剤中' },
  { value: 'audit_pending', label: '監査待ち' },
  { value: 'setting', label: 'セット監査待ち' },
  { value: 'set_audited', label: 'セット監査済み' },
  { value: 'visit_ready', label: '訪問準備完了' },
  { value: 'visit_completed', label: '訪問完了' },
  { value: 'reported', label: '報告済' },
  { value: 'on_hold', label: '保留' },
];

// ---------------------------------------------------------------------------
// 注意ポイント(複数選択チップ)
// ---------------------------------------------------------------------------

export type CareTag = 'narcotic' | 'cold_storage';

export const CARE_TAG_OPTIONS: Array<{ value: CareTag; label: string }> = [
  { value: 'narcotic', label: '麻薬' },
  { value: 'cold_storage', label: '冷所' },
];

// ---------------------------------------------------------------------------
// 予定の状態(VisitProposalStatus サブセット)
// ---------------------------------------------------------------------------

export type ProposalStatusOption = 'patient_contact_pending' | 'confirmed';

export const PROPOSAL_STATUS_OPTIONS: Array<{ value: ProposalStatusOption; label: string }> = [
  { value: 'patient_contact_pending', label: '患者確認待ち' },
  { value: 'confirmed', label: '正式決定' },
];

// ---------------------------------------------------------------------------
// 薬切れ期間プリセット
// ---------------------------------------------------------------------------

export type MedicationDeadlineDays = 3 | 7 | 14;

export const MEDICATION_DEADLINE_OPTIONS: Array<{
  value: MedicationDeadlineDays;
  label: string;
}> = [
  { value: 3, label: '3日以内' },
  { value: 7, label: '1週間以内' },
  { value: 14, label: '2週間以内' },
];

// ---------------------------------------------------------------------------
// 第一版 AND 接続可否フラグ
// ---------------------------------------------------------------------------

/** true = 第一版で AND 検索に反映可能、false = UI のみ(将来接続) */
export const ADVANCED_FILTER_CONNECTABLE: Record<keyof AdvancedFilterState, boolean> = {
  visitDateRange: true,
  assigneeId: true,
  cycleStatus: true,
  careTags: true,
  proposalStatus: false, // 将来接続 (/api/visit-schedule-proposals?status=)
  medicationDeadlineWithinDays: true,
};
