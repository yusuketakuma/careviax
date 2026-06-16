/**
 * new_03_schedule(今日のスケジュール — 全員)用の BFF レスポンス型。
 * /api/visit-schedules/day-board が返す担当者別レーン(薬剤師/事務)と
 * 未確定(受入判断)サマリーを、全員ガント / 未確定カードで共有する。
 * 右レール(次にやること/止まっている理由)は /api/dashboard/cockpit を共用する。
 */

export type DayBoardVisit = {
  id: string;
  patient_name: string;
  visit_type: string;
  schedule_status: string;
  priority: string;
  site_id: string | null;
  /** 同一担当・同一日の訪問順。未設定は時刻順の仮順で表示する */
  route_order: number | null;
  /** time_window_start(ISO)。未設定は null(ガントに置かない) */
  time_start: string | null;
  time_end: string | null;
  vehicle_resource_id: string | null;
  vehicle_label: string | null;
  vehicle_travel_mode: string | null;
  /** confirmed_at あり = 確定(🔒 変更は理由必須) */
  confirmed: boolean;
  /** 施設一括訪問の施設名(個人宅は null) */
  facility_label: string | null;
  /** 同一施設バッチの同日対象患者数(個人宅は 1) */
  facility_patient_count: number;
};

export type DayBoardStaffRoleKind = 'pharmacist' | 'clerk';

export type DayBoardStaff = {
  id: string;
  name: string;
  /** Membership.role(owner/admin/pharmacist/pharmacist_trainee/clerk) */
  role: string;
  role_kind: DayBoardStaffRoleKind;
  visits: DayBoardVisit[];
  /** 担当の未完了タスク件数(pending/in_progress)。デスク作業ブロックの仮置きに使用 */
  open_task_count: number;
  /** 担当の監査待ち(調剤完了)件数。「監査N件」ブロックの元データ */
  audit_task_count: number;
};

export type DayBoardPendingProposal = {
  id: string;
  patient_name: string;
  pharmacist_name: string | null;
  /** YYYY-MM-DD */
  proposed_date: string;
  /** time_window_start(ISO)。未設定は null */
  time_start: string | null;
  /** 受入判断 / 再調整 / 確定待ち */
  badge_label: string;
  /** 返答期限(最新コンタクトログの callback_due_at) */
  response_due_at: string | null;
  /** 確定した場合の担当余白の変化(分)。算出不能時は null */
  idle_before_minutes: number | null;
  idle_after_minutes: number | null;
};

export type ScheduleDayBoardResponse = {
  /** サーバー集計時刻(ISO)。「ルート計算 HH:MM」表示に使用 */
  generated_at: string;
  /** YYYY-MM-DD */
  date: string;
  staff: DayBoardStaff[];
  /** 組織全体の監査待ち件数(担当未割当タスクのフォールバック配分用) */
  audit_pending_count: number;
  /** 報告書待ち(visit_completed サイクル)件数。「報告」ブロックの元データ */
  report_pending_count: number;
  vehicle_resources: DayBoardVehicleResource[];
  pending_proposals: DayBoardPendingProposal[];
};

export type DayBoardVehicleResource = {
  id: string;
  label: string;
  site_id: string | null;
  vehicle_code: string | null;
  travel_mode: string;
  available: boolean;
  max_stops: number;
  assigned_visit_count: number;
  remaining_stops: number;
  recommended: boolean;
  recommendation_reason: string;
};
