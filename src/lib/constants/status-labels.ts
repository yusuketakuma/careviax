import type { StatusRole } from '@/lib/constants/status-tokens';

/**
 * セマンティック状態ロールの型。
 * - StatusRole(blocked/done/confirm/waiting/readonly/hazard/info) は中央トークン(globals.css の
 *   --state-* / --tag-*)に
 *   対応し、StateBadge/StatusDot の `role` にそのまま渡せる。
 * - 'neutral' は status-tokens に存在しない。「状態色を付けない=既定 Badge / text-muted を使う」運用上の指示であり、
 *   StateBadge には渡さず、呼び出し側で既定 Badge(variant default/secondary/outline) または text-muted-foreground を選ぶ。
 *
 * 正本: p0_46「画面で使う言葉をそろえる」6軸セマンティック。
 * CLAUDE.md 旧規則(患者: 稼働中=緑/保留=橙/終了=灰)は不採用。
 */
export type StatusRoleOrNeutral = StatusRole | 'neutral';

export const CASE_STATUS_LABELS: Record<string, string> = {
  referral_received: '紹介受領',
  assessment: 'アセスメント',
  active: '稼働中',
  on_hold: '保留',
  discharged: '終了',
  terminated: '解約',
};

export const CASE_STATUS_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  referral_received: 'secondary',
  assessment: 'secondary',
  active: 'default',
  on_hold: 'outline',
  discharged: 'outline',
  terminated: 'destructive',
};

export const GENDER_LABELS: Record<string, string> = {
  male: '男性',
  female: '女性',
  other: 'その他',
};

export const VISIT_OUTCOME_LABELS: Record<string, string> = {
  completed: '完了',
  revisit_needed: '再訪問必要',
  postponed: '延期',
  cancelled: 'キャンセル',
  delivery_only: '配薬のみ',
  completed_with_issue: '課題あり完了',
};

export const VISIT_OUTCOME_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  completed: 'default',
  revisit_needed: 'secondary',
  postponed: 'outline',
  cancelled: 'destructive',
  delivery_only: 'outline',
  completed_with_issue: 'secondary',
};

export const PRIORITY_LABELS: Record<string, string> = {
  emergency: '緊急',
  urgent: '至急',
  normal: '通常',
};

export const PRIORITY_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  emergency: 'destructive',
  urgent: 'secondary',
  normal: 'default',
};

export type StatusConfig = {
  label: string;
  variant: 'outline' | 'default' | 'destructive' | 'secondary';
};

export const REPORT_TYPE_LABELS: Record<string, string> = {
  physician_report: '医師向け報告書',
  care_manager_report: 'ケアマネ向け報告書',
  facility_handoff: '施設引継書',
  nurse_share: '看護師共有',
  family_share: '家族共有',
  internal_record: '内部記録',
};

export const REPORT_STATUS_CONFIG: Record<string, StatusConfig> = {
  draft: { label: '下書き', variant: 'outline' },
  sent: { label: '送付済', variant: 'default' },
  failed: { label: '送付失敗', variant: 'destructive' },
  confirmed: { label: '確認済', variant: 'default' },
  response_waiting: { label: '返信待ち', variant: 'secondary' },
};

export const CHANNEL_LABELS: Record<string, string> = {
  ph_os_share: 'PH-OS共有',
  email: 'メール',
  fax: 'FAX',
  phone: '電話',
  in_person: '手渡し',
  postal: '郵便',
  ses: 'メール(SES)',
};

/**
 * 連携ダッシュボードの「連絡キュー」channel 表示ラベル。
 * 配送系 channel(CHANNEL_LABELS)に加え、communication-queue が出す
 * 擬似 channel(patient_portal/collaboration/external_portal)も網羅する。
 * 配送 channel セレクタ(document-delivery-rule-manager 等)を汚さないため
 * CHANNEL_LABELS 本体は拡張せず、ここで spread して別マップにしている。
 */
export const COMMUNICATION_QUEUE_CHANNEL_LABELS: Record<string, string> = {
  ...CHANNEL_LABELS,
  patient_portal: '患者ポータル',
  collaboration: '多職種連携',
  external_portal: '外部共有',
};

/** 患者リスク水準(stable/watch/high)の日本語ラベル。patient-risk-card の表記と統一。 */
export const RISK_LEVEL_LABELS: Record<string, string> = {
  stable: '安定',
  watch: '注意',
  high: '高',
};

/**
 * システム稼働状態(ヘルスチェック)の日本語ラベル。admin/settings の HealthCard 用。
 * 上位ステータス(ok/degraded/down)に加え、取得前(loading)・サブチェック未取得(unknown)も含む。
 * サブチェックの status は string 型なので呼び出し側は `?? value` で防御する。
 */
export const HEALTH_STATUS_LABELS: Record<string, string> = {
  ok: '正常',
  degraded: '低下',
  down: '停止',
  unknown: '不明',
  loading: '確認中',
};

export const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  planned: '予定',
  in_preparation: '準備中',
  ready: '準備完了',
  departed: '出発',
  in_progress: '訪問中',
  completed: '完了',
  cancelled: 'キャンセル',
  postponed: '延期',
};

// ---------------------------------------------------------------------------
// セマンティック状態ロールマップ (p0_46 6軸の正本)
// ---------------------------------------------------------------------------
//
// 各 family の value → StatusRoleOrNeutral。後続フェーズの実装エージェントはこれを正本とし、
// StateBadge/StatusDot の role に渡す(neutral のみ既定 Badge / text-muted で表現)。
// 既存の *_VARIANTS / *_CONFIG は消費者の移行が完了するまで温存する(本ファイル上部)。
//
// 6軸の意味:
//   info(青)     : 主操作・現在地(current)・情報タグ・予定/待ち
//   blocked(赤)  : 止まっている理由・ブロッカー・キャンセル・送付失敗・通信なし
//   done(緑)     : 完了・承認済・確認済
//   confirm(橙)  : 確認が必要・保留・差戻し・延期・要対応
//   hazard(橙)   : 麻薬/冷所/インスリン/抗凝固 等の危険タグ
//   waiting(紫)  : 別の人(薬剤師/事務)の確認待ち
//   readonly(灰) : 閲覧のみ・権限なし・終了/退院・中立
//   neutral      : 状態色を付けない(既定 Badge / text-muted)

/** CaseStatus(患者ケース). active は意図的に neutral(状態色を付けない=既定/text-muted)。 */
export const CASE_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  referral_received: 'info',
  assessment: 'info',
  active: 'neutral',
  on_hold: 'confirm',
  discharged: 'readonly',
  terminated: 'blocked',
};

/** ScheduleStatus(訪問予定). 進行中の線形フローは info、completed=done、cancelled/no_show=blocked、postponed/rescheduled=confirm。 */
export const SCHEDULE_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  planned: 'info',
  in_preparation: 'info',
  ready: 'info',
  departed: 'info',
  in_progress: 'info',
  completed: 'done',
  cancelled: 'blocked',
  postponed: 'confirm',
  rescheduled: 'confirm',
  no_show: 'blocked',
};

/** VisitPriority / IssuePriority / TaskPriority 共通の優先度ロール。 */
export const PRIORITY_ROLE: Record<string, StatusRoleOrNeutral> = {
  emergency: 'blocked',
  critical: 'blocked',
  urgent: 'confirm',
  high: 'confirm',
  normal: 'info',
  medium: 'info',
  low: 'readonly',
};

/** 優先度 enum の日本語表示ラベル(PRIORITY_ROLE と同じキー集合)。生 enum をそのまま
 *  画面に出さず、StateBadge 等のテキストに使う(色のみ依存を避けアイコン+語で示す)。 */
export const PRIORITY_DISPLAY_LABELS: Record<string, string> = {
  emergency: '緊急',
  critical: '重大',
  urgent: '至急',
  high: '高',
  normal: '中',
  medium: '中',
  low: '低',
};

/** VisitOutcome(訪問結果). completed=done、cancelled=blocked、postponed/課題あり/再訪=confirm、配薬のみ=info。 */
export const VISIT_OUTCOME_ROLE: Record<string, StatusRoleOrNeutral> = {
  completed: 'done',
  revisit_needed: 'confirm',
  postponed: 'confirm',
  cancelled: 'blocked',
  delivery_only: 'info',
  completed_with_issue: 'confirm',
};

/** ReportStatus(報告書). confirmed/sent=done、failed=blocked、response_waiting=waiting、draft=neutral(下書き=未確定)。 */
export const REPORT_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  draft: 'neutral',
  sent: 'done',
  failed: 'blocked',
  confirmed: 'done',
  response_waiting: 'waiting',
};

/** MedicationCycleStatus(調剤サイクル). 線形フローは info、reported=done、on_hold=confirm、cancelled=blocked。 */
export const MEDICATION_CYCLE_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  intake_received: 'info',
  structuring: 'info',
  inquiry_pending: 'confirm',
  inquiry_resolved: 'info',
  ready_to_dispense: 'info',
  dispensing: 'info',
  dispensed: 'info',
  audit_pending: 'info',
  audited: 'info',
  setting: 'info',
  set_audited: 'info',
  visit_ready: 'info',
  visit_completed: 'info',
  reported: 'done',
  on_hold: 'confirm',
  cancelled: 'blocked',
};

/** TaskStatus. completed=done、cancelled=blocked、in_progress=info、pending=neutral(着手前)。 */
export const TASK_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  pending: 'neutral',
  in_progress: 'info',
  completed: 'done',
  cancelled: 'blocked',
};

/** IssueStatus. resolved=done、dismissed=readonly、in_progress=info、open=confirm(要対応)。 */
export const ISSUE_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  open: 'confirm',
  in_progress: 'info',
  resolved: 'done',
  dismissed: 'readonly',
};

/** VisitProposalStatus(訪問提案). confirmed=done、rejected/expired=blocked、患者連絡待ち=waiting、再調整=confirm、superseded=readonly。 */
export const VISIT_PROPOSAL_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  proposed: 'info',
  patient_contact_pending: 'waiting',
  confirmed: 'done',
  rejected: 'blocked',
  superseded: 'readonly',
  expired: 'blocked',
  reschedule_pending: 'confirm',
};

/** PatientContactStatus(患者連絡). confirmed=done、declined/unreachable=blocked、change_requested=confirm、attempted=info、pending=neutral。 */
export const PATIENT_CONTACT_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  pending: 'neutral',
  attempted: 'info',
  confirmed: 'done',
  declined: 'blocked',
  change_requested: 'confirm',
  unreachable: 'blocked',
};

/** RequestStatus(疑義照会など依頼). responded/closed=done、escalated/cancelled/expired=blocked/confirm、received/in_progress=info、sent=waiting、draft=neutral。 */
export const REQUEST_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  draft: 'neutral',
  sent: 'waiting',
  received: 'info',
  in_progress: 'info',
  responded: 'done',
  closed: 'readonly',
  escalated: 'confirm',
  cancelled: 'blocked',
  expired: 'blocked',
};

/** TracingReportStatus(トレーシングレポート). acknowledged=done、received=info、sent=waiting、draft=neutral。 */
export const TRACING_REPORT_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  draft: 'neutral',
  sent: 'waiting',
  received: 'info',
  acknowledged: 'done',
};

/** SelfReportStatus(患者自己申告). resolved/converted_to_task=done、dismissed=readonly、triaged=info、submitted=confirm(要対応)。 */
export const SELF_REPORT_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  submitted: 'confirm',
  triaged: 'info',
  converted_to_task: 'done',
  resolved: 'done',
  dismissed: 'readonly',
};

/** SelfReportStatus の日本語表示ラベル(SELF_REPORT_STATUS_ROLE と同じキー集合)。生 enum を
 *  画面にそのまま出さないために使う。 */
export const SELF_REPORT_STATUS_LABELS: Record<string, string> = {
  submitted: '未対応',
  triaged: 'トリアージ済',
  converted_to_task: 'タスク化',
  resolved: '解決済',
  dismissed: '見送り',
};

/** PatientShareCaseStatus(他薬局への患者共有). active=done(共有成立)、revoked/declined=blocked、各種pending=waiting、suspended=confirm、ended=readonly、draft=neutral。 */
export const PATIENT_SHARE_CASE_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  draft: 'neutral',
  consent_pending: 'waiting',
  partner_confirmation_pending: 'waiting',
  active: 'done',
  suspended: 'confirm',
  revoked: 'blocked',
  ended: 'readonly',
  declined: 'blocked',
};

/** PharmacyVisitRequestStatus(連携訪問依頼の長い進行フロー). completed=done、declined/returned=blocked/confirm、進行中=info、相手待ち=waiting、draft=neutral。 */
export const PHARMACY_VISIT_REQUEST_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  draft: 'neutral',
  requested: 'waiting',
  accepted: 'info',
  declined: 'blocked',
  scheduled: 'info',
  visited: 'info',
  recording: 'info',
  submitted: 'waiting',
  base_reviewing: 'waiting',
  returned: 'confirm',
  confirmed: 'info',
  physician_report_created: 'info',
  claim_checked: 'info',
  completed: 'done',
};

/** PharmacyContractStatus(連携契約). active=done、expired/terminated=blocked、各種承認待ち=waiting、suspended=confirm、draft=neutral。 */
export const PHARMACY_CONTRACT_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  draft: 'neutral',
  pending_base_approval: 'waiting',
  pending_partner_approval: 'waiting',
  active: 'done',
  expired: 'blocked',
  terminated: 'blocked',
  suspended: 'confirm',
};

/** VisitBillingStatus(訪問算定). confirmed/invoiced=done、voided/excluded=blocked/readonly、candidate=neutral(未確定)。 */
export const VISIT_BILLING_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  candidate: 'neutral',
  confirmed: 'done',
  excluded: 'readonly',
  invoiced: 'done',
  voided: 'blocked',
};

/** QrDraftStatus(QRスキャン下書き). confirmed=done、discarded=blocked、pending=neutral(未確定)。 */
export const QR_DRAFT_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  pending: 'neutral',
  confirmed: 'done',
  discarded: 'blocked',
};

/** PackagingInstructionTag(一包化の危険/注意タグ). 麻薬/冷所/粉砕禁止 等は隠さない hazard、それ以外の作業指示は info。 */
export const PACKAGING_INSTRUCTION_TAG_ROLE: Record<string, StatusRoleOrNeutral> = {
  cold_storage: 'hazard',
  narcotic: 'hazard',
  crush_prohibited: 'hazard',
  half_tablet: 'info',
  separate_pack: 'info',
  unit_dose: 'info',
  staple_required: 'info',
  label_required: 'info',
};

/** DispenseAuditResult(調剤鑑査結果). approved/emergency_approved=done、rejected=blocked、hold=confirm。 */
export const DISPENSE_AUDIT_RESULT_ROLE: Record<string, StatusRoleOrNeutral> = {
  approved: 'done',
  rejected: 'blocked',
  hold: 'confirm',
  emergency_approved: 'done',
};

/** SetAuditResult(セット監査結果). approved=done、partial_approved=confirm、rejected=blocked。 */
export const SET_AUDIT_RESULT_ROLE: Record<string, StatusRoleOrNeutral> = {
  approved: 'done',
  partial_approved: 'confirm',
  rejected: 'blocked',
};

/** SetCellState(セットセル進捗). set=done、hold=confirm、pending=neutral(未着手)。 */
export const SET_CELL_STATE_ROLE: Record<string, StatusRoleOrNeutral> = {
  pending: 'neutral',
  set: 'done',
  hold: 'confirm',
};

/** SetAuditCellState(セット監査セル状態 quad). ok=done、ng=blocked、unaudited=neutral(未監査)。 */
export const SET_AUDIT_CELL_STATE_ROLE: Record<string, StatusRoleOrNeutral> = {
  unaudited: 'neutral',
  ok: 'done',
  ng: 'blocked',
};

/** UserAccountStatus(アカウント). active=done、suspended/cognito_failed=blocked、retired=readonly、invited/pending_cognito=waiting。 */
export const USER_ACCOUNT_STATUS_ROLE: Record<string, StatusRoleOrNeutral> = {
  pending_cognito: 'waiting',
  invited: 'waiting',
  active: 'done',
  suspended: 'blocked',
  retired: 'readonly',
  cognito_failed: 'blocked',
};
