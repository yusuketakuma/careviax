import type { PermissionKey } from '@/lib/auth/permissions';

/**
 * Single source of truth for the 統計 (statistics) hub.
 *
 * The hub does NOT rebuild any analytics — it links to the existing detailed pages
 * (each enforces its own RLS/permission on navigation). Every surface here MUST point
 * at an internal app route (no external href); coverage + route existence are asserted
 * by statistics-surfaces.test.ts so the registry cannot silently drift.
 *
 * Provenance / reconciliation: the recon sweep (wf_624ac1cd) surfaced 64 raw items. They
 * reconcile to this 23-page navigable manifest — see STATISTICS_RECON_PROVENANCE below.
 * A navigable hub can only deep-link to navigable PAGES, so API endpoints, embedded
 * widgets, and nav aliases are excluded (with rationale), and same-route widgets are
 * absorbed into one page entry. This is the auditable record so the manifest is not
 * mistaken for a silent scope shrink of the original "64".
 */

export const STATISTICS_CATEGORIES = [
  '経営',
  '請求',
  '運用',
  '在庫',
  '人員',
  '品質',
  '連携',
  'コンプライアンス',
  '患者',
] as const;

export type StatisticsCategory = (typeof STATISTICS_CATEGORIES)[number];

export type StatisticsSurface = {
  /** stable, unique id */
  id: string;
  label: string;
  description: string;
  /** internal app route only (starts with '/') */
  href: string;
  category: StatisticsCategory;
  /**
   * Permission the destination page requires. The hub only renders a card the current role
   * is permitted to reach (card exposure must not exceed destination access).
   */
  requiredPermission: PermissionKey;
};

export const STATISTICS_SURFACES: StatisticsSurface[] = [
  // 経営
  {
    id: 'management-metrics',
    label: '経営指標ダッシュボード',
    description: '処方集中率・後発品調剤割合・薬剤師あたり処方枚数・在宅訪問実績などの経営KPI。',
    href: '/admin/metrics',
    category: '経営',
    requiredPermission: 'canAdmin',
  },
  // 請求
  {
    id: 'billing-analytics',
    label: 'KPI分析（請求SSOT・地域資源）',
    description: '請求候補・算定可率・締め進捗の月次分析と地域資源マップ。',
    href: '/admin/analytics',
    category: '請求',
    // 遷移先 /admin/analytics の API は canReport(請求エビデンス分析)+canVisit(地域資源マップ)で観測可能だが、
    // 請求 SSOT を扱うカードのため、より厳格な canManageBilling を意図的に要求する（access-minimization。
    // destination より厳しい＝露出を狭める方向なので「card 露出 <= destination」の不変条件は満たす）。
    requiredPermission: 'canManageBilling',
  },
  {
    id: 'billing-check',
    label: '算定チェック',
    description: '当月の算定候補・レビュー待ち・算定可否のチェック状況。',
    href: '/billing',
    category: '請求',
    requiredPermission: 'canManageBilling',
  },
  // 運用
  {
    id: 'operations-insights',
    label: '在宅業務の動き',
    description: '月別訪問件数の推移と工程別の平均所要時間（直近30日）。',
    href: '/admin/operations-insights',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  {
    id: 'capacity',
    label: 'キャパシティ・詰まり',
    description: '本日の訪問枠・調剤セット・スタッフ稼働率・緊急対応余力と工程の滞留。',
    href: '/admin/capacity',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  {
    id: 'performance',
    label: '運用パフォーマンス',
    description: '主要ルートのパフォーマンス指標とスタッフ別KPIパネル。',
    href: '/admin/performance',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  {
    id: 'realtime',
    label: 'リアルタイム運用監視',
    description: '通知・ワークフローの稼働状況をリアルタイムに監視。',
    href: '/admin/realtime',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  {
    id: 'master-hub',
    label: 'マスター鮮度ハブ',
    description: '医薬品・施設・スタッフなど各マスターの件数・最終更新・鮮度。',
    href: '/admin',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  {
    id: 'cockpit',
    label: '運用コックピット',
    description: '配薬サイクル状態・本日訪問・繰越タスク・チーム稼働の集約ビュー。',
    href: '/dashboard',
    category: '運用',
    requiredPermission: 'canViewDashboard',
  },
  {
    id: 'pilot-readiness',
    label: 'パイロット準備状況',
    description: 'パイロット立ち上げの外部準備状況とUAT集計。',
    href: '/admin/uat',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  {
    id: 'clerk-support',
    label: '事務サポート集計',
    description: '受付待ち・送付先未設定・予定確認など事務サポートのKPI。',
    href: '/clerk-support',
    category: '運用',
    // 遷移先 /api/dashboard/clerk-support は canViewDashboard で gate。事務(clerk)向けの導線のため
    // destination と一致させる（clerk は canVisit:false / canViewDashboard:true）。
    requiredPermission: 'canViewDashboard',
  },
  {
    id: 'workflow-outcomes',
    label: 'ワークフロー工程・連絡',
    description: '工程段階別の件数・アウトカム指標と連絡キューの集計。',
    href: '/workflow',
    category: '運用',
    // 遷移先のヘッドライン API /api/dashboard/workflow は canViewDashboard で gate。destination と一致。
    requiredPermission: 'canViewDashboard',
  },
  {
    id: 'schedule-metrics',
    label: 'スケジュール日次メトリクス',
    description: '訪問予定の状態・優先度・ロック/オフラインの日次集計。',
    href: '/schedules',
    category: '運用',
    requiredPermission: 'canVisit',
  },
  {
    id: 'intake-triage',
    label: '処方受付トリアージ',
    description: '受付処方のレーン別件数とトリアージ状況。',
    href: '/prescriptions/intake',
    category: '運用',
    // 遷移先のヘッドライン API /api/prescription-intakes/triage は canViewDashboard で gate。destination と一致。
    requiredPermission: 'canViewDashboard',
  },
  {
    id: 'job-monitoring',
    label: 'ジョブ監視',
    description: '連携ジョブ（IntegrationJob）の状態・エラー・手動再実行の監視。',
    href: '/admin/jobs',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  // 在庫
  {
    id: 'inventory-forecast',
    label: '在庫×定期処方の予測',
    description: '来週の薬剤別必要量見込みと薬局在庫・影響患者の予測。',
    href: '/admin/inventory-forecast',
    category: '在庫',
    requiredPermission: 'canAdmin',
  },
  // 人員
  {
    id: 'staff-workload',
    label: 'スタッフ稼働',
    description: 'スタッフ別のタスク・訪問・調剤の業務量と稼働スコア。',
    href: '/tasks',
    category: '人員',
    requiredPermission: 'canVisit',
  },
  // 品質
  {
    id: 'dispense-audit-stats',
    label: '調剤鑑査差戻し分析',
    description: '鑑査差戻し理由の内訳と件数（期間指定）。',
    href: '/admin/dispense-audit-stats',
    category: '品質',
    requiredPermission: 'canAdmin',
  },
  {
    id: 'incidents',
    label: 'ヒヤリハット管理',
    description: 'インシデントの重大度・状態と再発防止の記録状況。',
    href: '/admin/incidents',
    category: '品質',
    requiredPermission: 'canAdmin',
  },
  // 連携
  {
    id: 'report-delivery',
    label: '報告書送達分析',
    description: '報告書配信のチャネル・状態・月別の送達状況。',
    href: '/reports/analytics',
    category: '連携',
    // 遷移先 /api/care-reports/analytics は canSendCareReport で gate。destination と一致させる
    // （pharmacist_trainee は canVisit:true だが canSendCareReport:false のため遷移先を開けない＝カードも出さない）。
    requiredPermission: 'canSendCareReport',
  },
  // コンプライアンス
  {
    id: 'audit-logs',
    label: '監査ログ',
    description: 'システム操作の監査証跡。',
    href: '/admin/audit-logs',
    category: 'コンプライアンス',
    requiredPermission: 'canAdmin',
  },
  // 患者
  {
    id: 'patients-board',
    label: '患者カード一覧',
    description: '患者状態の一覧サマリーと稼働状況。',
    href: '/patients',
    category: '患者',
    requiredPermission: 'canVisit',
  },
  {
    id: 'visit-preparation',
    label: '本日の訪問準備',
    description: '本日の訪問予定と準備状況のボード。',
    href: '/visits',
    category: '患者',
    requiredPermission: 'canVisit',
  },
];

/**
 * Reconciliation artifact: the recon sweep's 64 raw items reduce to the 23-page manifest above.
 * Excluded classes are non-navigable; same-route widgets are absorbed into one page entry.
 */
export const STATISTICS_RECON_PROVENANCE = {
  raw_recon_items: 64,
  navigable_pages: STATISTICS_SURFACES.length, // 23
  excluded: [
    {
      kind: 'api-endpoint',
      count: 22,
      rationale:
        '集計データの取得元であり、ナビゲート先のページではない（hub はページにしかリンクできない）。',
    },
    {
      kind: 'nav-alias',
      count: 8,
      rationale: 'ナビゲーション設定上のメタデータであり、統計サーフェスそのものではない。',
    },
    {
      kind: 'embedded-widget-absorbed',
      count: 11,
      rationale:
        'ページ内に埋め込まれた統計ウィジェット。親ページの1エントリに吸収（例: staff-kpi-panel → /admin/performance、cockpit ウィジェット → /dashboard）。',
    },
  ],
} as const;

/**
 * Whether a role may enter the statistics hub at all. canViewDashboard is the entrance baseline;
 * roles without it (e.g. driver / external_viewer) must not see the directory.
 */
export function canEnterStatisticsHub(can: (permission: PermissionKey) => boolean): boolean {
  return can('canViewDashboard');
}

/**
 * Filter the manifest to the surfaces a role is permitted to reach. Pure (predicate-based) so it
 * can be unit-tested with any role without server coupling.
 */
export function filterStatisticsSurfaces(
  surfaces: StatisticsSurface[],
  can: (permission: PermissionKey) => boolean,
): StatisticsSurface[] {
  return surfaces.filter((surface) => can(surface.requiredPermission));
}
