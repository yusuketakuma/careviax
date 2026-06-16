/**
 * new_10_report(報告・共有ワークスペース)BFF レスポンス型。
 * /api/care-reports/today-workspace が返す「今日書く報告 / 返信待ち / 今日解決した待ち」
 * の集約(docs/design-gap-analysis-new.md 10_report)。
 */

export type ReportDraftRowStatus =
  | 'before_visit'
  | 'ready_to_generate'
  | 'draft_ready'
  | 'report_existing';

export type ReportDraftRow = {
  id: string;
  /** 訪問予定時刻(ISO)。時刻未確定は null。 */
  time_start: string | null;
  /** 「伊藤 キヨ 様」「施設グリーンヒル」 */
  patient_label: string;
  /** 「ケアマネ(中島様)」「医師(山本先生)+ケアマネ」「施設(看護師長)」 */
  recipient_label: string;
  /** before_visit=「訪問後に下書き」/ ready_to_generate=「未作成」/ draft_ready=「下書きあり」/ report_existing=「作成済み」 */
  status: ReportDraftRowStatus;
  /** 訪問記録が確定し、報告書下書きを自動作成できる場合に入る。 */
  visit_record_id: string | null;
  /** 「麻薬使用状況を含む」「12名分を1通に集約」等の常時表示メモ。無ければ null。 */
  note: string | null;
  /** 行アクション。note がある行でも導線を隠さず併記する。 */
  action: { label: string; href: string } | null;
};

export type ReportWaitingReplyAction = {
  label: string;
  href: string;
  /** button=アウトラインボタン / link=青リンク */
  kind: 'button' | 'link';
};

export type ReportWaitingReply = {
  id: string;
  kind: 'report_delivery' | 'inquiry';
  /** 経過日数。 */
  waiting_days: number;
  /** 「加藤 ミサ 様 — ケアマネへの服薬状況報告」 */
  title: string;
  subtitle: string | null;
  actions: ReportWaitingReplyAction[];
};

export type ReportResolvedToday = {
  id: string;
  /** 回答受領時刻(ISO)。 */
  received_at: string;
  /** 「佐々木 ハル 様 — 残薬照会(やまもと内科)」 */
  title: string;
  subtitle: string;
  action: { label: string; href: string };
};

export type ReportCreatedRow = {
  id: string;
  patient_label: string;
  report_type: string;
  report_type_label: string;
  status: string;
  status_label: string;
  title: string;
  created_at: string;
  updated_at: string;
  reported_to_professional: boolean;
  last_sent_at: string | null;
  last_recipient_label: string | null;
  last_channel: string | null;
  action: { label: string; href: string };
};

export type ReportOpenIssueSeverity = 'critical' | 'warning' | 'info';

export type ReportOpenIssue = {
  id: string;
  report_id: string;
  severity: ReportOpenIssueSeverity;
  title: string;
  description: string;
  action: { label: string; href: string };
};

export type ReportsTodayWorkspaceResponse = {
  generated_at: string;
  draft_rows: ReportDraftRow[];
  waiting_replies: ReportWaitingReply[];
  resolved_today: ReportResolvedToday[];
  created_reports: ReportCreatedRow[];
  open_issues: ReportOpenIssue[];
  counts: {
    to_write: number;
    waiting: number;
    resolved: number;
    created: number;
    open_issues: number;
  };
  evidence: {
    /** 宛先別テンプレート種数(送付テンプレート N種) */
    template_count: number;
    /** 今月の送付履歴件数 */
    monthly_delivery_count: number;
  };
};
