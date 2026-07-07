/**
 * new_01_dashboard(運用コックピット)用の BFF レスポンス型。
 * /api/dashboard/cockpit が返す集計を、条件バナー / 今すぐ対応 / 今日の流れ /
 * 工程の今 / 右レール(次にやること・止まっている理由・根拠・記録)で共有する。
 */

export type CockpitAuditQueueItem = {
  task_id: string;
  cycle_id: string;
  patient_name: string;
  /** DispenseTask.priority(emergency/urgent/normal) */
  priority: string;
  /** 監査期限(ISO)。未設定は null */
  due_at: string | null;
  /** RX 番号生成用(formatPrescriptionCardNumber)の元データ */
  intake_id: string | null;
  /** YYYY-MM-DD */
  prescribed_date: string | null;
  /** PackagingInstructionTag のキー(narcotic/cold_storage/unit_dose 等)。麻薬を先頭に整列 */
  handling_tags: string[];
  has_narcotic: boolean;
  /** 調剤完了(監査待ち開始)時刻 ISO */
  waiting_since: string | null;
};

export type CockpitVisit = {
  id: string;
  patient_name: string;
  visit_type: string;
  schedule_status: string;
  /** time_window_start を "HH:MM" 壁時計で表現(@db.Time の UTC parts 由来)。未設定は null */
  time_start: string | null;
  time_end: string | null;
  /** 施設一括訪問のグループキー(同一値はまとめて表示) */
  facility_batch_id: string | null;
};

export type CockpitBlockedReason = {
  id: string;
  label: string;
  severity: 'critical' | 'warning';
  /** 患者 / 事務 / 医療機関 / 調剤 などのカテゴリチップ */
  category: string | null;
  /** 発生からの経過分 */
  age_minutes: number;
  action_label: string;
  action_href: string;
};

export type CockpitTeamMember = {
  user_id: string;
  name: string;
  /** 「薬」(薬剤師系)/「事務」 */
  role_label: string;
  /** off = 当日シフトで不在(「休み」表示) */
  status: 'working' | 'off';
  /** 今日の残り勤務から残予定の拘束を引いた目安(分)。off は null */
  slack_minutes: number | null;
  /** 残り勤務に対する拘束割合 0..1(余白バーの長さ)。off は null */
  busy_ratio: number | null;
};

export type CockpitCommentItem = {
  id: string;
  entity_type:
    | 'dispense_task'
    | 'medication_cycle'
    | 'set_plan'
    | 'visit_record'
    | 'care_report'
    | 'patient';
  entity_id: string;
  entity_label: string;
  author_id: string;
  author_name: string;
  content_excerpt: string;
  mentions_me: boolean;
  authored_by_me: boolean;
  created_at: string;
  href: string;
};

export type CockpitInboundSignalItem = {
  id: string;
  signal_domain: string;
  signal_type: string;
  extracted_text: string | null;
  extracted_medication_name: string | null;
  extracted_quantity: number | null;
  extracted_unit: string | null;
  review_status: string;
  action_status: string;
  source_confidence: string;
};

export type CockpitInboundItem = {
  id: string;
  event_id: string;
  channel: string;
  channel_label: string;
  event_type: string;
  processing_status: string;
  status: 'needs_review' | 'reviewed_pending_action' | 'task_created' | 'task_completed';
  priority: 'urgent' | 'high' | 'normal';
  patient_id: string | null;
  patient_name: string | null;
  sender_name: string | null;
  sender_role: string | null;
  sender_organization_name: string | null;
  sender_contact: string | null;
  title: string;
  summary: string;
  raw_text: string;
  normalized_summary: string | null;
  received_at: string;
  occurred_at: string | null;
  due_at: string | null;
  attachment_count: number;
  has_medication_stock_signal: boolean;
  has_patient_safety_signal: boolean;
  has_schedule_signal: boolean;
  has_report_signal: boolean;
  signals: CockpitInboundSignalItem[];
  action_href: string;
  action_label: string;
};

export type DashboardUrgentItem = {
  id: string;
  source:
    | 'audit'
    | 'inbound'
    | 'medication_stock'
    | 'visit_preparation'
    | 'report'
    | 'callback'
    | 'billing'
    | 'task';
  source_id: string;
  source_label: string;
  reference_label: string | null;
  severity: 'blocking' | 'urgent' | 'warning';
  patient_id: string | null;
  patient_name: string | null;
  title: string;
  summary: string;
  due_at: string | null;
  waiting_since: string | null;
  badges: Array<{
    label: string;
    tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  }>;
  action_href: string;
  action_label: string;
};

export type DashboardCockpitScope = 'mine' | 'team';

export type DashboardCockpitScopeMetadata = {
  /** サーバー集計時刻(ISO)。右レール「今朝の同期」に表示 */
  generated_at: string;
  /** 表示範囲。旧呼び出し互換のため optional。 */
  scope?: {
    requested: DashboardCockpitScope;
    applied: DashboardCockpitScope;
    can_view_team: boolean;
  };
};

export type DashboardCockpitSummaryResponse = DashboardCockpitScopeMetadata & {
  /** MedicationCycle.overall_status → 件数(cancelled を除く)。工程の今(9工程)の元データ */
  cycle_status_counts: Record<string, number>;
  /** 監査待ちキューの総件数。 */
  audit_queue_total_count?: number;
  audit_pending_count: number;
  narcotic_audit_count: number;
  /** PHI を含まない最初の監査期限。条件バナーの初期表示用。 */
  earliest_audit_due_at: string | null;
  /** PHI を含まない本日訪問件数。 */
  today_visit_count: number;
  /** PHI を含まない本日訪問の開始時刻一覧。 */
  today_visit_times: string[];
};

export type DashboardCockpitDetailsResponse = DashboardCockpitScopeMetadata & {
  /** 監査待ちキューの総件数。 */
  audit_queue_total_count?: number;
  /** audit_queue に実際に含まれる表示件数。 */
  audit_queue_visible_count?: number;
  /** 総件数から表示件数を引いた非表示件数。PHI を含まない件数メタデータ。 */
  audit_queue_hidden_count?: number;
  /** 監査待ちキュー(麻薬優先・緊急度順)。今すぐ対応カードの元データ */
  audit_queue: CockpitAuditQueueItem[];
  urgent_items: DashboardUrgentItem[];
  urgent_total_count: number;
  urgent_visible_count: number;
  urgent_hidden_count: number;
  today_visits: CockpitVisit[];
  blocked_reasons: CockpitBlockedReason[];
  /** 昨日以前に作成され、まだ完了していないタスク件数(根拠・記録「昨日からの持ち越し」) */
  carryover_count: number;
};

export type DashboardCockpitTeamResponse = DashboardCockpitScopeMetadata & {
  /** チームの余白(残り時間の目安)。工程の今の隣に表示 */
  team_capacity: CockpitTeamMember[];
};

export type DashboardCockpitCommentsResponse = DashboardCockpitScopeMetadata & {
  /** Dashboard scope で閲覧可能な直近コメント。本文は短い抜粋だけ返す。 */
  comments: CockpitCommentItem[];
  comments_total_count: number;
  comments_visible_count: number;
  comments_hidden_count: number;
};

export type DashboardCockpitInboundResponse = DashboardCockpitScopeMetadata & {
  inbound_items: CockpitInboundItem[];
  inbound_total_count: number;
  inbound_visible_count: number;
  inbound_hidden_count: number;
  inbound_needs_review_count: number;
  inbound_reviewed_pending_action_count: number;
  inbound_urgent_count: number;
  inbound_medication_stock_signal_count: number;
  inbound_safety_signal_count: number;
};

export type DashboardMedicationStockRiskItem = {
  id: string;
  source: 'inbound_signal';
  signal_id: string;
  inbound_event_id: string;
  patient_id: string | null;
  patient_name: string | null;
  case_id: string | null;
  risk_level: 'urgent' | 'shortage_expected' | 'review_required' | 'usage_unknown' | 'linked';
  signal_type: string;
  review_status: string;
  action_status: string;
  medication_name: string | null;
  quantity_label: string | null;
  source_text: string | null;
  source_channel: string;
  source_label: string;
  sender_role: string | null;
  received_at: string;
  updated_at: string;
  action_href: string;
  action_label: string;
  badges: Array<{
    label: string;
    tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  }>;
};

export type DashboardCockpitMedicationStockResponse = DashboardCockpitScopeMetadata & {
  stock_summary: {
    urgent_shortage_count: number;
    shortage_expected_count: number;
    usage_unknown_count: number;
    equivalence_review_count: number;
    inbound_stock_signal_count: number;
    linked_to_stock_event_count: number;
  };
  stock_items: DashboardMedicationStockRiskItem[];
  stock_items_total_count: number;
  stock_items_visible_count: number;
  stock_items_hidden_count: number;
};

export type DashboardReportBillingItem = {
  id: string;
  kind:
    | 'report_draft'
    | 'report_delivery_failed'
    | 'report_waiting_confirmation'
    | 'billing_candidate_pending';
  source_id: string;
  patient_id: string | null;
  patient_name: string | null;
  title: string;
  summary: string;
  status: string;
  severity: 'blocking' | 'urgent' | 'warning';
  reference_label: string | null;
  due_at: string | null;
  waiting_since: string | null;
  updated_at: string;
  action_href: string;
  action_label: string;
  badges: Array<{
    label: string;
    tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  }>;
};

export type DashboardCockpitReportBillingResponse = DashboardCockpitScopeMetadata & {
  reports: {
    draft_needed_count: number;
    delivery_failed_count: number;
    waiting_confirmation_count: number;
  };
  billing: {
    blocker_count: number;
    close_queue_count: number;
    month_end_risk_count: number;
    can_view_billing: boolean;
  };
  items: DashboardReportBillingItem[];
  items_total_count: number;
  items_visible_count: number;
  items_hidden_count: number;
};

export type DashboardCockpitResponse = DashboardCockpitScopeMetadata & {
  /** MedicationCycle.overall_status → 件数(cancelled を除く)。工程の今(9工程)の元データ */
  cycle_status_counts: Record<string, number>;
  /** 監査待ちキューの総件数。旧クライアント互換のため audit_pending_count と同値で返す。 */
  audit_queue_total_count?: number;
  /** audit_queue に実際に含まれる表示件数。 */
  audit_queue_visible_count?: number;
  /** 総件数から表示件数を引いた非表示件数。PHI を含まない件数メタデータ。 */
  audit_queue_hidden_count?: number;
  audit_pending_count: number;
  narcotic_audit_count: number;
  /** 監査待ちキュー(麻薬優先・緊急度順)。今すぐ対応カードの元データ */
  audit_queue: CockpitAuditQueueItem[];
  urgent_items?: DashboardUrgentItem[];
  urgent_total_count?: number;
  urgent_visible_count?: number;
  urgent_hidden_count?: number;
  today_visits: CockpitVisit[];
  blocked_reasons: CockpitBlockedReason[];
  /** 昨日以前に作成され、まだ完了していないタスク件数(根拠・記録「昨日からの持ち越し」) */
  carryover_count: number;
  /** チームの余白(残り時間の目安)。工程の今の隣に表示 */
  team_capacity: CockpitTeamMember[];
  /** 右レール「チームの会話」。旧 full route 用。 */
  comments?: CockpitCommentItem[];
  comments_total_count?: number;
  comments_visible_count?: number;
  comments_hidden_count?: number;
};
