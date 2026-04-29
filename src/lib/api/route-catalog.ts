import type { PermissionKey } from '@/lib/auth/permissions';

export type RouteCatalogEntry = {
  path: string;
  methods: string[];
  permission: PermissionKey | 'authenticated' | 'purpose-based' | 'canAdmin|apiKey';
  description: string;
  area:
    | 'patients'
    | 'cases'
    | 'schedules'
    | 'visits'
    | 'prescriptions'
    | 'dispensing'
    | 'reports'
    | 'shifts'
    | 'dashboard'
    | 'masters'
    | 'files'
    | 'system';
};

export const routeCatalog: RouteCatalogEntry[] = [
  {
    path: '/api/patients',
    methods: ['GET', 'POST'],
    permission: 'canVisit',
    description: '患者一覧取得と患者登録',
    area: 'patients',
  },
  {
    path: '/api/patients/:id',
    methods: ['GET', 'PATCH'],
    permission: 'canVisit',
    description: '患者詳細取得と更新',
    area: 'patients',
  },
  {
    path: '/api/cases',
    methods: ['GET', 'POST'],
    permission: 'canVisit',
    description: 'ケース一覧取得と新規作成',
    area: 'cases',
  },
  {
    path: '/api/cases/:id/transition',
    methods: ['PATCH'],
    permission: 'canVisit',
    description: 'ケース状態遷移',
    area: 'cases',
  },
  {
    path: '/api/visit-schedules',
    methods: ['GET', 'POST'],
    permission: 'canVisit',
    description: '訪問予定一覧取得と作成',
    area: 'schedules',
  },
  {
    path: '/api/visit-schedules/generate',
    methods: ['POST'],
    permission: 'canVisit',
    description: '定期訪問の一括生成',
    area: 'schedules',
  },
  {
    path: '/api/visit-schedules/today',
    methods: ['GET'],
    permission: 'canVisit',
    description: '本日の訪問予定取得',
    area: 'schedules',
  },
  {
    path: '/api/visit-records',
    methods: ['GET', 'POST'],
    permission: 'canVisit',
    description: '訪問記録一覧取得と保存',
    area: 'visits',
  },
  {
    path: '/api/visit-records/:id',
    methods: ['GET', 'PATCH'],
    permission: 'canVisit',
    description: '訪問記録詳細取得と更新',
    area: 'visits',
  },
  {
    path: '/api/visit-records/:id/pdf',
    methods: ['GET'],
    permission: 'canVisit',
    description: '訪問記録 PDF 出力',
    area: 'visits',
  },
  {
    path: '/api/prescription-intakes',
    methods: ['GET', 'POST'],
    permission: 'canDispense',
    description: '処方箋受付一覧取得と登録',
    area: 'prescriptions',
  },
  {
    path: '/api/medication-cycles/:id/transition',
    methods: ['PATCH'],
    permission: 'canDispense',
    description: 'MedicationCycle の状態遷移',
    area: 'prescriptions',
  },
  {
    path: '/api/dispense-queue',
    methods: ['GET'],
    permission: 'canDispense',
    description: '調剤キュー一覧取得',
    area: 'dispensing',
  },
  {
    path: '/api/dispense-results',
    methods: ['POST'],
    permission: 'canDispense',
    description: '調剤実績登録',
    area: 'dispensing',
  },
  {
    path: '/api/dispense-audits',
    methods: ['GET', 'POST'],
    permission: 'canAuditDispense',
    description: '鑑査一覧取得と鑑査実行',
    area: 'dispensing',
  },
  {
    path: '/api/care-reports',
    methods: ['GET', 'POST'],
    permission: 'canReport',
    description: '報告書一覧取得と作成',
    area: 'reports',
  },
  {
    path: '/api/care-reports/:id/send',
    methods: ['POST'],
    permission: 'canSendCareReport',
    description: '報告書送付',
    area: 'reports',
  },
  {
    path: '/api/care-reports/:id/pdf',
    methods: ['GET'],
    permission: 'canReport',
    description: '報告書 PDF 出力',
    area: 'reports',
  },
  {
    path: '/api/tracing-reports',
    methods: ['GET', 'POST'],
    permission: 'canReport',
    description: 'トレーシングレポート一覧取得と作成',
    area: 'reports',
  },
  {
    path: '/api/tracing-reports/:id/pdf',
    methods: ['GET'],
    permission: 'canReport',
    description: 'トレーシングレポート PDF 出力',
    area: 'reports',
  },
  {
    path: '/api/pharmacist-shifts',
    methods: ['GET', 'POST'],
    permission: 'canAdmin',
    description: 'シフト一覧取得と登録',
    area: 'shifts',
  },
  {
    path: '/api/pharmacist-shifts/available',
    methods: ['GET'],
    permission: 'canVisit',
    description: '空き薬剤師検索',
    area: 'shifts',
  },
  {
    path: '/api/dashboard/today',
    methods: ['GET'],
    permission: 'canViewDashboard',
    description: '本日ダッシュボード集計',
    area: 'dashboard',
  },
  {
    path: '/api/dashboard/overdue',
    methods: ['GET'],
    permission: 'canViewDashboard',
    description: '期限超過の訪問・報告・タスク一覧',
    area: 'dashboard',
  },
  {
    path: '/api/dashboard/monthly-stats',
    methods: ['GET'],
    permission: 'canViewDashboard',
    description: '患者別×保険種別の月間訪問回数進捗',
    area: 'dashboard',
  },
  {
    path: '/api/dashboard/workflow',
    methods: ['GET'],
    permission: 'canViewDashboard',
    description: '工程別ワークフロー集計',
    area: 'dashboard',
  },
  {
    path: '/api/drug-masters',
    methods: ['GET'],
    permission: 'canAdmin',
    description: '医薬品マスタ検索',
    area: 'masters',
  },
  {
    path: '/api/drug-master-imports/ssk',
    methods: ['POST'],
    permission: 'canAdmin',
    description: 'SSK 医薬品マスタ取込',
    area: 'masters',
  },
  {
    path: '/api/drug-master-imports/mhlw-price',
    methods: ['POST'],
    permission: 'canAdmin',
    description: 'MHLW 薬価基準収載品目取込',
    area: 'masters',
  },
  {
    path: '/api/drug-master-imports/mhlw-generic',
    methods: ['POST'],
    permission: 'canAdmin',
    description: 'MHLW 一般名処方/後発フラグ取込',
    area: 'masters',
  },
  {
    path: '/api/drug-master-imports/hot',
    methods: ['POST'],
    permission: 'canAdmin',
    description: 'HOT コードマスタ取込',
    area: 'masters',
  },
  {
    path: '/api/drug-master-imports/pmda',
    methods: ['POST'],
    permission: 'canAdmin',
    description: 'PMDA 添付文書 XML 取込',
    area: 'masters',
  },
  {
    path: '/api/drug-master-imports/manual-clinical',
    methods: ['POST'],
    permission: 'canAdmin',
    description: '手動投入用の高齢者/腎機能/ハイリスク薬ルール取込',
    area: 'masters',
  },
  {
    path: '/api/files/presigned-upload',
    methods: ['POST'],
    permission: 'authenticated',
    description: 'S3 presigned PUT URL 発行',
    area: 'files',
  },
  {
    path: '/api/files/complete',
    methods: ['POST'],
    permission: 'authenticated',
    description: 'アップロード完了コールバック',
    area: 'files',
  },
  {
    path: '/api/files/:id/presigned-download',
    methods: ['GET'],
    permission: 'purpose-based',
    description: '用途別権限を確認した上で S3 presigned GET URL を発行',
    area: 'files',
  },
  {
    path: '/api/files/:id/download',
    methods: ['GET'],
    permission: 'purpose-based',
    description: '用途別権限を確認した上で S3 署名付きURLへリダイレクトしてファイルをダウンロード',
    area: 'files',
  },
  {
    path: '/api/management-plans/:id/pdf',
    methods: ['GET'],
    permission: 'canVisit',
    description: '管理計画書 PDF 出力',
    area: 'patients',
  },
  {
    path: '/api/patients/:id/medications/pdf',
    methods: ['GET'],
    permission: 'canVisit',
    description: '薬歴・服薬一覧 PDF 出力',
    area: 'patients',
  },
  {
    path: '/api/patients/medications/bulk-export',
    methods: ['POST'],
    permission: 'canVisit',
    description: '患者選択済みの薬歴 PDF を ZIP 一括出力キューへ登録',
    area: 'patients',
  },
  {
    path: '/api/patients/:id/medication-calendar/pdf',
    methods: ['GET'],
    permission: 'canVisit',
    description: '服薬カレンダー PDF 出力',
    area: 'patients',
  },
  {
    path: '/api/patients/:id/visit-records/pdf',
    methods: ['GET'],
    permission: 'canVisit',
    description: '患者単位・期間指定の訪問記録一覧 PDF 出力',
    area: 'patients',
  },
  {
    path: '/api/jobs',
    methods: ['GET'],
    permission: 'canAdmin',
    description: 'ジョブ定義と最新実行状況の一覧取得',
    area: 'system',
  },
  {
    path: '/api/jobs/:jobType',
    methods: ['POST'],
    permission: 'canAdmin|apiKey',
    description: 'ジョブの手動実行またはスケジューラ実行',
    area: 'system',
  },
  {
    path: '/api/meta/route-catalog',
    methods: ['GET'],
    permission: 'canAdmin',
    description: 'Route Handler 一覧定義',
    area: 'system',
  },
];
