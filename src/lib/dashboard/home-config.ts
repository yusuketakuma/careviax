import {
  buildConferencesHref,
  buildExternalHref,
  buildMyDayHref,
  buildNotificationsHref,
  buildReportsHref,
  buildHandoffHref,
  buildTasksHref,
  buildWorkflowHref,
} from '@/lib/dashboard/home-link-builders';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';

export const DASHBOARD_PIPELINE_STEPS = [
  {
    key: 'intake',
    label: '受付',
    statuses: [
      'intake_received',
      'structuring',
      'inquiry_pending',
      'inquiry_resolved',
    ],
  },
  {
    key: 'dispensing',
    label: '調剤',
    statuses: ['ready_to_dispense', 'dispensing', 'dispensed'],
  },
  {
    key: 'dispense_audit',
    label: '鑑査',
    statuses: ['audit_pending', 'audited'],
  },
  {
    key: 'medication_set',
    label: 'セット',
    statuses: ['setting'],
  },
  {
    key: 'set_audit',
    label: 'セット監査',
    statuses: ['set_audited'],
  },
  {
    key: 'visit_planning',
    label: 'スケジュール',
    statuses: ['visit_ready'],
  },
  {
    key: 'visit_execution',
    label: '訪問',
    statuses: [],
  },
  {
    key: 'reporting',
    label: '報告書',
    statuses: ['visit_completed'],
  },
] as const;

export type DashboardTaskTabKey =
  | 'all'
  | 'intake'
  | 'dispensing'
  | 'dispense_audit'
  | 'medication_set'
  | 'set_audit'
  | 'visit_planning'
  | 'visit'
  | 'reporting';

export type DashboardTaskTabDefinition = {
  key: DashboardTaskTabKey;
  label: string;
  pipelineKeys: string[] | null;
};

export const DASHBOARD_TASK_TABS: DashboardTaskTabDefinition[] = [
  { key: 'all', label: '全て', pipelineKeys: null },
  { key: 'intake', label: '処方', pipelineKeys: ['intake'] },
  { key: 'dispensing', label: '調剤', pipelineKeys: ['dispensing'] },
  { key: 'dispense_audit', label: '監査', pipelineKeys: ['dispense_audit'] },
  { key: 'medication_set', label: 'セット', pipelineKeys: ['medication_set'] },
  { key: 'set_audit', label: 'セット監査', pipelineKeys: ['set_audit'] },
  {
    key: 'visit_planning',
    label: 'スケジュール',
    pipelineKeys: ['visit_planning'],
  },
  { key: 'visit', label: '訪問', pipelineKeys: ['visit_execution'] },
  { key: 'reporting', label: '報告書', pipelineKeys: ['reporting'] },
];

export const DASHBOARD_TASK_TYPE_TO_TAB: Record<string, DashboardTaskTabKey> = {
  visit_intake_linkage: 'intake',
  prescription_original_retention: 'intake',
  fax_original_followup: 'intake',
  dosage_form_support: 'dispensing',
  residual_reduction_review: 'dispensing',
  inquiry_workbench: 'dispense_audit',
  medication_set_queue: 'medication_set',
  set_audit_queue: 'set_audit',
  visit_demand: 'visit_planning',
  visit_contact_followup: 'visit_planning',
  visit_preparation: 'visit_planning',
  visit_schedule_override_approval: 'visit_planning',
  visit_carry_item_review: 'visit_planning',
  facility_batch_tracker: 'visit_planning',
  visit_schedule: 'visit',
  mobile_visit_mode: 'visit',
  visit_record_retention: 'visit',
  initial_home_visit_assessment: 'visit',
  report_delivery_followup: 'reporting',
  report_response_followup: 'reporting',
  tracing_report_followup: 'reporting',
  management_plan_review: 'reporting',
  community_activity_followup: 'reporting',
};

export const DASHBOARD_TAB_FALLBACK_ACTIONS: Record<
  Exclude<DashboardTaskTabKey, 'all'>,
  { href: string; label: string }
> = {
  intake: {
    href: '/prescriptions',
    label: '処方受付を開く',
  },
  dispensing: {
    href: '/dispensing',
    label: '調剤キューを開く',
  },
  dispense_audit: {
    href: '/auditing',
    label: '調剤監査を開く',
  },
  medication_set: {
    href: '/medication-sets',
    label: 'セット管理を開く',
  },
  set_audit: {
    href: '/medication-sets',
    label: 'セット監査を開く',
  },
  visit_planning: {
    href: '/schedules',
    label: 'スケジュールを開く',
  },
  visit: {
    href: '/visits',
    label: '訪問記録を開く',
  },
  reporting: {
    href: '/reports',
    label: '報告書を開く',
  },
};

export type DashboardNavigationLink = {
  key: string;
  title: string;
  description: string;
  href: string;
};

export const DASHBOARD_WORKFLOW_LINKS: readonly DashboardNavigationLink[] = [
  {
    key: 'referrals',
    title: '紹介受付',
    description: '患者紹介からケース起票までの受け皿を開きます。',
    href: '/referrals/new',
  },
  {
    key: 'prescriptions',
    title: '処方登録',
    description: '新規処方受付と施設単位の一括取り込みを開始します。',
    href: '/prescriptions',
  },
  {
    key: 'qr_drafts',
    title: 'QR下書き',
    description: '読み取り済み QR 下書きを確認し、受付入力へ引き継ぎます。',
    href: '/prescriptions/qr-drafts',
  },
  {
    key: 'qr_scan',
    title: 'QRスキャン',
    description: '処方箋 QR を読み取り、その場で受付下書きを作成します。',
    href: '/qr-scan',
  },
  {
    key: 'dispensing',
    title: '調剤',
    description: '調剤待ちキューから優先案件を処理します。',
    href: '/dispensing',
  },
  {
    key: 'auditing',
    title: '調剤監査',
    description: '調剤結果の鑑査と差し戻し対応を確認します。',
    href: '/auditing',
  },
  {
    key: 'medication_sets',
    title: 'セット管理',
    description: 'セット計画、グリッド鑑査、持参パック作成へ進みます。',
    href: '/medication-sets',
  },
  {
    key: 'set_audit',
    title: 'セット監査',
    description: 'セット結果の承認・差戻しを確認し、持参内容を確定します。',
    href: '/medication-sets',
  },
  {
    key: 'schedules',
    title: '訪問スケジュール設定',
    description: '訪問予定と施設バッチをまとめて調整します。',
    href: '/schedules',
  },
  {
    key: 'visits',
    title: '訪問時情報収集',
    description: '訪問記録、持参物、事前要約をもとに現場入力します。',
    href: '/visits',
  },
  {
    key: 'reports',
    title: '報告書作成',
    description: '下書き作成と送付待ちの報告書を管理します。',
    href: buildReportsHref({
      focus: 'delivery',
      deliveryStatus: 'response_waiting',
      context: 'dashboard_home',
    }),
  },
  {
    key: 'conferences',
    title: '他職種連携',
    description: 'カンファレンス記録と連携アクションを追跡します。',
    href: buildConferencesHref({
      focus: 'notes',
      context: 'dashboard_home',
    }),
  },
] as const;

export const DASHBOARD_WORKBENCH_LINKS: readonly DashboardNavigationLink[] = [
  {
    key: 'my_day',
    title: 'My Day',
    description: '担当訪問、未完了タスク、緊急アクションを個人単位で見ます。',
    href: buildMyDayHref({
      focus: 'visits',
      visitFilter: 'unprepared',
      context: 'dashboard_home',
    }),
  },
  {
    key: 'workflow',
    title: '工程ダッシュボード',
    description: '工程別集計、例外、連携滞留を横断で確認します。',
    href: buildWorkflowHref({
      focus: 'control_center',
      context: 'dashboard_home',
    }),
  },
  {
    key: 'tasks',
    title: 'タスク一覧',
    description: '運用タスクをまとめて棚卸しし、一括完了や再割当へ進みます。',
    href: buildTasksHref({
      assigned: 'me',
      status: 'pending',
      context: 'dashboard_home',
    }),
  },
  {
    key: 'billing',
    title: '請求支援',
    description: '請求候補、締めブロック、算定根拠の不足を確認します。',
    href: '/billing',
  },
  {
    key: 'billing_candidates',
    title: '請求候補',
    description: '締め前に確認が必要な請求候補へ直接移動します。',
    href: '/billing/candidates',
  },
  {
    key: 'schedule_proposals',
    title: '提案一覧',
    description: '訪問スケジュール提案と差戻し対応をまとめて確認します。',
    href: '/schedules/proposals',
  },
] as const;

export const DASHBOARD_COORDINATION_LINKS: readonly DashboardNavigationLink[] = [
  {
    key: 'notifications',
    title: '通知',
    description: '未読通知、緊急アラート、システム連絡をまとめて確認します。',
    href: buildNotificationsHref({
      tab: 'unread',
      type: 'urgent',
      context: 'dashboard_home',
    }),
  },
  {
    key: 'external',
    title: '外部連携',
    description: '自己申告、共有リンク、地域フォローの対応状況を見ます。',
    href: buildExternalHref({
      focus: 'self_reports',
      context: 'dashboard_home',
    }),
  },
  {
    key: 'communications',
    title: '依頼・照会',
    description: '返信待ち、照会対応、外部との連携依頼を追跡します。',
    href: buildCommunicationRequestsHref({
      status: 'sent',
      context: 'dashboard_home',
    }),
  },
  {
    key: 'handoff',
    title: '申し送り',
    description: 'シフト交代の引き継ぎ事項と確認漏れを整理します。',
    href: buildHandoffHref({
      filter: 'unread',
      context: 'dashboard_home',
    }),
  },
] as const;

export const DASHBOARD_ADMIN_LINKS: readonly DashboardNavigationLink[] = [
  {
    key: 'admin_dashboard',
    title: '管理ダッシュボード',
    description: '運営状況、滞留、例外残件を管理者視点で横断確認します。',
    href: '/admin',
  },
  {
    key: 'data_explorer',
    title: 'データ探索',
    description: '運用データを断面別に確認し、監査や調査へ進みます。',
    href: '/admin/data-explorer',
  },
  {
    key: 'jobs',
    title: 'ジョブ監視',
    description: 'バッチや配信処理の状態を追跡し、手動実行へ進みます。',
    href: '/admin/jobs',
  },
  {
    key: 'metrics',
    title: '経営指標',
    description: '月次の進捗や送達状況を指標ベースで確認します。',
    href: '/admin/metrics',
  },
] as const;

export const DASHBOARD_HEADER_SHORTCUTS = [
  { href: '/settings', label: 'ユーザー設定' },
  { href: '/qr-scan', label: 'QRスキャン' },
  { href: '/admin/notification-settings', label: '通知設定' },
] as const;
