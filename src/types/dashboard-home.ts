export type QueuePriority = 'urgent' | 'high' | 'normal' | 'low';

// ---- Pipeline (中段上部) ----

export type PipelineStep = {
  key: string;
  label: string;
  count: number;
};

// ---- Actions (中段下部) ----

export type ActionItem = {
  id: string;
  item_type: 'task' | 'proposal' | 'visit' | 'self_report' | 'aggregate';
  task_type: string | null;
  queue_label: string;
  title: string;
  summary: string;
  priority: QueuePriority;
  due_at: string | null;
  action_href: string;
  action_label: string;
  owner_name: string | null;
  patient_name: string | null;
  badges: string[];
};

export type DashboardActionsResponse = {
  pipeline: PipelineStep[];
  actions: ActionItem[];
};

// ---- Patients (下段) ----

export type PatientStatusIcon =
  | 'stable'              // 安定 — 特に問題なし
  | 'new'                 // 新規 — 初回訪問未実施
  | 'first_visit_soon'    // 初回予定 — 初回訪問が予定されている
  | 'attention'           // 要確認 — 未処理タスクや期限接近あり
  | 'urgent'              // 要対応 — 期限超過や高リスク
  | 'overdue_visit'       // 訪問遅延 — 予定日を過ぎた訪問あり
  | 'report_pending'      // 報告未提出 — 報告書の提出が滞っている
  | 'medication_change'   // 処方変更 — 直近で処方変更あり、経過観察中
  | 'hospitalized'        // 入院中
  | 'discharged'          // 退院直後 — 退院後の経過フォロー中
  | 'no_contact'          // 連絡不通 — 患者に連絡がつかない
  | 'paused';             // 休止中

export type PatientCard = {
  patient_id: string;
  patient_name: string;
  birth_date: string;
  address: string | null;
  phone: string | null;
  conditions: string[];
  last_prescription_date: string | null;
  last_visit_date: string | null;
  next_prescription_date: string | null;
  next_visit_date: string | null;
  next_visit_type: string | null;
  case_id: string | null;
  status_icon: PatientStatusIcon;
};

export type DashboardPatientsResponse = {
  patients: PatientCard[];
  total: number;
};
