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
    label: '準備',
    statuses: ['visit_ready'],
  },
  {
    key: 'visit_execution',
    label: '訪問',
    statuses: [],
  },
  {
    key: 'reporting',
    label: '報告',
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

export const DASHBOARD_WORKFLOW_LINKS = [
  {
    key: 'prescriptions',
    title: '処方登録',
    description: '新規処方受付と施設単位の一括取り込みを開始します。',
    href: '/prescriptions',
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
    href: '/reports',
  },
  {
    key: 'conferences',
    title: '他職種連携',
    description: 'カンファレンス記録と連携アクションを追跡します。',
    href: '/conferences',
  },
] as const;
