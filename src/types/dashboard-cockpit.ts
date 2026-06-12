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
  /** time_window_start(ISO)。未設定は null */
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

export type DashboardCockpitResponse = {
  /** サーバー集計時刻(ISO)。右レール「今朝の同期」に表示 */
  generated_at: string;
  /** MedicationCycle.overall_status → 件数(cancelled を除く)。工程の今(9工程)の元データ */
  cycle_status_counts: Record<string, number>;
  audit_pending_count: number;
  narcotic_audit_count: number;
  /** 監査待ちキュー(麻薬優先・緊急度順)。今すぐ対応カードの元データ */
  audit_queue: CockpitAuditQueueItem[];
  today_visits: CockpitVisit[];
  blocked_reasons: CockpitBlockedReason[];
  /** 昨日以前に作成され、まだ完了していないタスク件数(根拠・記録「昨日からの持ち越し」) */
  carryover_count: number;
  /** チームの余白(残り時間の目安)。工程の今の隣に表示 */
  team_capacity: CockpitTeamMember[];
};
