export type SystemSettingGenre =
  | 'safety_workflow'
  | 'notifications'
  | 'scheduling_capacity'
  | 'pharmacy_master'
  | 'security_access'
  | 'offline_integration';

export type SystemSettingCandidateStatus =
  | 'managed'
  | 'partial'
  | 'local_only'
  | 'env_only'
  | 'hardcoded'
  | 'missing';

export type SystemSettingCandidate = {
  id: string;
  genre: SystemSettingGenre;
  label: string;
  currentSurface: string;
  recommendation: string;
  status: SystemSettingCandidateStatus;
  evidence: string[];
};

export const SYSTEM_SETTING_GENRE_LABELS: Record<SystemSettingGenre, string> = {
  safety_workflow: '安全・工程',
  notifications: '通知・割り込み',
  scheduling_capacity: 'スケジュール・余力',
  pharmacy_master: '薬局・マスター',
  security_access: 'セキュリティ・権限',
  offline_integration: 'オフライン・連携',
};

export const SYSTEM_SETTING_STATUS_LABELS: Record<SystemSettingCandidateStatus, string> = {
  managed: '設定化済み',
  partial: '一部設定化',
  local_only: '端末内のみ',
  env_only: '環境変数のみ',
  hardcoded: '固定値',
  missing: '未設定',
};

export const SYSTEM_SETTING_STATUS_TONE: Record<SystemSettingCandidateStatus, string> = {
  managed: 'border-state-done/30 bg-state-done/10 text-state-done',
  partial: 'border-tag-info/30 bg-tag-info/10 text-tag-info',
  local_only: 'border-state-waiting/30 bg-state-waiting/10 text-state-waiting',
  env_only: 'border-state-readonly/30 bg-state-readonly/10 text-state-readonly',
  hardcoded: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  missing: 'border-state-blocked/30 bg-state-blocked/10 text-state-blocked',
};

export const SYSTEM_SETTING_CANDIDATES: readonly SystemSettingCandidate[] = [
  {
    id: 'locked-safety-items',
    genre: 'safety_workflow',
    label: '安全タグ・二人制監査・緊急通知のロック',
    currentSurface: '/settings の運用ポリシー API で常時 ON として返却',
    recommendation:
      '設定画面では変更不可の安全ロックとして表示し、PATCH では受け付けない状態を維持する。',
    status: 'managed',
    evidence: ['src/app/api/settings/operational-policy/route.ts'],
  },
  {
    id: 'safety-sign-sensitivity',
    genre: 'safety_workflow',
    label: '安全サインの感度',
    currentSurface: 'Setting(scope=organization, key=operational_policy)',
    recommendation:
      '安全タグより下げられない説明と、通知・患者カードへの影響範囲をセットで管理する。',
    status: 'managed',
    evidence: [
      'src/app/api/settings/operational-policy/route.ts',
      'src/app/(dashboard)/settings/operational-policy-content.tsx',
    ],
  },
  {
    id: 'wip-guides',
    genre: 'safety_workflow',
    label: '工程別 WIP 目安',
    currentSurface: 'ダッシュボードとハンドオフ提案で固定の工程目安を参照',
    recommendation: '工程別上限、改定日、適用対象を設定として管理し、詰まり管理画面へ接続する。',
    status: 'partial',
    evidence: [
      'src/app/(dashboard)/dashboard/dashboard-cockpit.helpers.ts',
      'src/app/api/handoff-board/items/route.test.ts',
    ],
  },
  {
    id: 'audit-checklists',
    genre: 'safety_workflow',
    label: '監査チェックリストと差戻し理由',
    currentSurface: '監査・セット監査の各画面で理由語彙とチェック項目が分散',
    recommendation: '理由コード、表示ラベル、監査証跡への保存要否をジャンル別設定として統一する。',
    status: 'partial',
    evidence: [
      'src/components/features/dispense-workbench/dispensing-workbench.tsx',
      'src/components/features/workflow/reason-dialog.tsx',
      'docs/design-gap-analysis.md',
    ],
  },
  {
    id: 'wait-release-notification',
    genre: 'notifications',
    label: '待ち解除通知',
    currentSurface: 'Setting(scope=organization, key=operational_policy)',
    recommendation: '通知センター、工程の今、ハンドオフへの影響範囲を明示して変更する。',
    status: 'managed',
    evidence: ['src/app/api/settings/operational-policy/route.ts'],
  },
  {
    id: 'quiet-hours',
    genre: 'notifications',
    label: '静かな時間',
    currentSurface: 'Setting(scope=organization, key=operational_policy)',
    recommendation: '訪問モード中の非緊急通知抑制として、緊急通知ロックと対で表示する。',
    status: 'managed',
    evidence: ['src/app/api/settings/operational-policy/route.ts'],
  },
  {
    id: 'browser-notifications',
    genre: 'notifications',
    label: 'ブラウザ通知の許可',
    currentSurface: 'localStorage と PushSubscription API',
    recommendation: '端末ごとの許可状態とユーザー通知設定を同じ設定画面から確認できるようにする。',
    status: 'local_only',
    evidence: ['src/lib/browser-notifications.ts', 'src/app/api/push-subscription/route.ts'],
  },
  {
    id: 'notification-rules',
    genre: 'notifications',
    label: '通知ルール・エスカレーション',
    currentSurface: '/admin/notification-settings と notification-rules/escalation-rules API',
    recommendation: '運用ポリシー側には要約と変更導線を出し、詳細編集は管理画面へ集約する。',
    status: 'partial',
    evidence: [
      'src/app/(dashboard)/admin/notification-settings/notification-settings-content.tsx',
      'src/app/api/notification-rules/[id]/route.ts',
      'src/app/api/admin/escalation-rules/route.ts',
    ],
  },
  {
    id: 'care-work-mode',
    genre: 'scheduling_capacity',
    label: '業務モード・ケアモード',
    currentSurface: 'ui-store と /api/me/preferences',
    recommendation: 'ユーザー設定として現在モード、開始ページ、表示範囲を一覧化する。',
    status: 'managed',
    evidence: [
      'src/lib/stores/ui-store.ts',
      'src/app/api/me/preferences/route.ts',
      'src/components/layout/app-header.tsx',
    ],
  },
  {
    id: 'site-switching',
    genre: 'scheduling_capacity',
    label: '現在薬局・既定薬局',
    currentSurface: 'auth-store、/api/me/site、/api/pharmacy-sites',
    recommendation: '所属薬局、既定薬局、切替監査を設定メニューにまとめる。',
    status: 'partial',
    evidence: [
      'src/app/api/me/site/route.ts',
      'src/app/api/pharmacy-sites/route.ts',
      'src/lib/stores/auth-store.ts',
    ],
  },
  {
    id: 'capacity-assumptions',
    genre: 'scheduling_capacity',
    label: '営業時間・訪問所要時間・余力計算',
    currentSurface: '9:00-18:00、訪問 60 分などが集計ロジックに固定',
    recommendation: '薬局単位の営業時間、昼休み、既定訪問時間、余力計算式を設定化する。',
    status: 'hardcoded',
    evidence: [
      'src/lib/analytics/capacity.ts',
      'src/app/api/visit-schedules/day-board/route.ts',
      'src/app/api/dashboard/cockpit/team-capacity.ts',
    ],
  },
  {
    id: 'visit-limits',
    genre: 'scheduling_capacity',
    label: '訪問上限・車両稼働上限',
    currentSurface: 'スタッフ/車両/保険別の個別フィールドとバリデーション',
    recommendation: '薬局の既定上限、職種別上限、車両上限の優先順位を設定画面で見える化する。',
    status: 'partial',
    evidence: [
      'src/app/api/visit-routes/route.ts',
      'src/app/api/visit-preparations/[scheduleId]/route.ts',
      'src/app/api/admin/staff-metrics/route.ts',
    ],
  },
  {
    id: 'pharmacy-profile',
    genre: 'pharmacy_master',
    label: '薬局基本情報',
    currentSurface: 'PharmacySite と admin/settings の site scope に分散',
    recommendation:
      '薬局名、コード、住所、電話、営業時間、既定担当を 1 つの設定ジャンルにまとめる。',
    status: 'partial',
    evidence: [
      'src/app/api/pharmacy-sites/[id]/route.ts',
      'src/lib/admin/settings-catalog.ts',
      'docs/design-gap-analysis.md',
    ],
  },
  {
    id: 'drug-stock-policy',
    genre: 'pharmacy_master',
    label: '採用品・在庫下限・発注候補',
    currentSurface: 'pharmacy-drug-stocks 系 API と drug masters 管理画面',
    recommendation: '在庫下限、採用品設定、フォローアップ期限を薬局設定として一覧化する。',
    status: 'partial',
    evidence: [
      'src/app/api/pharmacy-drug-stocks/route.ts',
      'src/app/api/admin/inventory-forecast/route.ts',
    ],
  },
  {
    id: 'vehicle-inspection-policy',
    genre: 'pharmacy_master',
    label: '車両点検期限・稼働可否',
    currentSurface: 'master-hub の鮮度判定と vehicles 管理',
    recommendation: '点検期限の警告日数、配車除外条件、車両メモの扱いを設定化する。',
    status: 'hardcoded',
    evidence: ['src/app/api/admin/master-hub/route.ts', 'src/app/(dashboard)/admin/vehicles'],
  },
  {
    id: 'session-timeout',
    genre: 'security_access',
    label: 'セッションタイムアウト・警告時刻',
    currentSurface: 'クライアント側で 30 分、警告 5 分前に固定',
    recommendation: '組織のセキュリティ設定として、MFA 必須と同じ場所で管理する。',
    status: 'hardcoded',
    evidence: [
      'src/components/auth/session-timeout-modal.tsx',
      'src/lib/admin/settings-catalog.ts',
    ],
  },
  {
    id: 'mfa-and-recovery',
    genre: 'security_access',
    label: 'MFA 必須・リカバリーコード',
    currentSurface: 'admin settings catalog、Cognito MFA、Setting の recovery code',
    recommendation: '組織ポリシーと個人状態を分けて、設定画面では必須方針と自分の状態を併記する。',
    status: 'partial',
    evidence: [
      'src/lib/admin/settings-catalog.ts',
      'src/server/services/mfa-recovery.ts',
      'src/app/api/me/profile/route.ts',
    ],
  },
  {
    id: 'rate-limit-csrf',
    genre: 'security_access',
    label: 'CSRF・レート制限',
    currentSurface: 'proxy と rate-limit catalog',
    recommendation: '管理者向けには保護中の API 群と制限種別を読み取り専用で表示する。',
    status: 'env_only',
    evidence: ['src/proxy.ts', 'src/lib/api/rate-limit.ts'],
  },
  {
    id: 'offline-evidence-limits',
    genre: 'offline_integration',
    label: 'オフライン証跡キュー容量',
    currentSurface: '証跡 1 件 25MB、キュー 75MB、再送バッチ 10 件が固定',
    recommendation: '端末負荷と証跡保存方針として、管理者が上限と現在値を確認できるようにする。',
    status: 'hardcoded',
    evidence: ['src/phos/api/offlineEvidenceQueue.ts'],
  },
  {
    id: 'offline-action-replay',
    genre: 'offline_integration',
    label: 'オフライン操作再送',
    currentSurface: '再送バッチ 25 件が固定',
    recommendation: '競合解決ポリシー、最大再送数、バッチサイズを設定候補として可視化する。',
    status: 'hardcoded',
    evidence: ['src/phos/api/offlineActionQueue.ts'],
  },
  {
    id: 'print-output-settings',
    genre: 'offline_integration',
    label: '帳票・印刷出力設定',
    currentSurface: '印刷ハブのローカル状態',
    recommendation: '患者名/施設名/QR/控え保存の既定値を薬局設定として保存する。',
    status: 'local_only',
    evidence: ['src/app/(dashboard)/reports/print/print-hub-content.tsx'],
  },
  {
    id: 'webhook-delivery-policy',
    genre: 'offline_integration',
    label: 'Webhook 再送・同時実行・タイムアウト',
    currentSurface: 'retry limit 50、concurrency 4、timeout 10 秒などがサービス内固定',
    recommendation: '外部連携設定として、送信先ごとのイベント種別と再送ポリシーを表示する。',
    status: 'hardcoded',
    evidence: ['src/server/services/outbound-webhook.ts', 'src/app/api/admin/webhooks/route.ts'],
  },
  {
    id: 'phos-api-runtime-limits',
    genre: 'offline_integration',
    label: 'PH-OS API タイムアウト・レスポンス上限',
    currentSurface: 'PHOS_* 環境変数とクライアント側上限',
    recommendation: '運用診断向けに現在値、最大値、環境変数由来かを読み取り専用で表示する。',
    status: 'env_only',
    evidence: ['src/phos/api/client.ts', 'src/phos/backend/aurora-fee-rules-repository.ts'],
  },
];

export function groupSystemSettingCandidates() {
  return (Object.keys(SYSTEM_SETTING_GENRE_LABELS) as SystemSettingGenre[]).map((genre) => ({
    genre,
    label: SYSTEM_SETTING_GENRE_LABELS[genre],
    items: SYSTEM_SETTING_CANDIDATES.filter((item) => item.genre === genre),
  }));
}
