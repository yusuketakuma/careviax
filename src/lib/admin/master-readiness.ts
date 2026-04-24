export type AdminMasterReadinessItem = {
  label: string;
  href: string;
  purpose: string;
};

export type AdminMasterReadinessGroup = {
  key: string;
  title: string;
  description: string;
  items: readonly AdminMasterReadinessItem[];
};

export type AdminMasterReadinessStatus = 'ready' | 'warning' | 'missing';

export type AdminMasterReadinessItemSummary = AdminMasterReadinessItem & {
  status: AdminMasterReadinessStatus;
  count: number;
  detail: string;
  issues: string[];
};

export type AdminMasterReadinessGroupSummary = Omit<AdminMasterReadinessGroup, 'items'> & {
  status: AdminMasterReadinessStatus;
  ready_count: number;
  warning_count: number;
  missing_count: number;
  items: AdminMasterReadinessItemSummary[];
};

export type AdminMasterReadinessSnapshot = {
  generated_at: string;
  summary: {
    ready_count: number;
    warning_count: number;
    missing_count: number;
  };
  groups: AdminMasterReadinessGroupSummary[];
};

export const ADMIN_MASTER_READINESS_GROUPS: readonly AdminMasterReadinessGroup[] = [
  {
    key: 'operations',
    title: '薬局・運用設定',
    description: '訪問予定、通知、休日、薬局単位の算定条件を支える基盤設定です。',
    items: [
      { label: '管理設定', href: '/admin/settings', purpose: '組織全体の基本設定' },
      { label: '薬局情報', href: '/admin/pharmacy-sites', purpose: '拠点、所在地、薬局設定' },
      { label: '休日カレンダー', href: '/admin/business-holidays', purpose: '訪問候補生成の休業日判定' },
      { label: '通知設定', href: '/admin/notification-settings', purpose: '滞留・訪問・報告の通知制御' },
    ],
  },
  {
    key: 'visit-place',
    title: '訪問先・同時訪問マスター',
    description: '施設・ユニット、個人宅同居グループ、訪問エリア、施設基準をまとめて整備します。',
    items: [
      { label: '施設', href: '/admin/facilities', purpose: '施設・ユニット・同時訪問の母艦' },
      { label: '訪問エリア', href: '/admin/service-areas', purpose: '訪問範囲と移動前提' },
      { label: '施設基準', href: '/admin/facility-standards', purpose: '届出・算定可否の管理' },
      { label: '医療機関', href: '/admin/institutions', purpose: '処方元・報告先の医療機関' },
    ],
  },
  {
    key: 'collaboration',
    title: '他職種連携マスター',
    description: '患者情報から取得するクリニック・訪問看護・ケアマネの送付先候補を支えます。',
    items: [
      { label: '他職種', href: '/admin/external-professionals', purpose: '職種別の連携先マスター' },
      { label: '連携先', href: '/admin/contact-profiles', purpose: '送付チャネルと実績学習' },
      { label: '文書テンプレート', href: '/admin/document-templates', purpose: '報告書・共有文書の雛形' },
    ],
  },
  {
    key: 'pharmacy-work',
    title: '薬剤・調剤マスター',
    description: '処方登録、調剤、監査、セットへ渡す薬剤・安全確認の基礎データです。',
    items: [
      { label: '採用薬', href: '/admin/formulary', purpose: '薬局採用品と代替判断' },
      { label: '配薬方法', href: '/admin/packaging-methods', purpose: 'セット・患者設定で使う配薬方法' },
      { label: '医薬品マスター', href: '/admin/drug-masters', purpose: '調剤・監査・セットへ渡す薬剤基本情報' },
      { label: '処方安全アラート', href: '/admin/alert-rules', purpose: '監査・訪問前確認の警告条件' },
    ],
  },
  {
    key: 'staff-billing',
    title: 'スタッフ・請求・監査',
    description: '担当割当、シフト、資格、請求ルール、監査証跡をまとめて確認します。',
    items: [
      { label: 'スタッフ', href: '/admin/staff', purpose: '担当者・職種・稼働管理' },
      { label: 'ユーザー', href: '/admin/users', purpose: '権限とログイン管理' },
      { label: 'シフト', href: '/admin/shifts', purpose: '担当者の訪問可能枠' },
      { label: '薬剤師資格', href: '/admin/pharmacist-credentials', purpose: '在宅算定に関わる資格管理' },
      { label: '請求ルール', href: '/admin/billing-rules', purpose: '算定要件とルールSSOT' },
      { label: '監査ログ', href: '/admin/audit-logs', purpose: '操作履歴と遷移証跡' },
    ],
  },
];

export function listAdminMasterReadinessHrefs() {
  return ADMIN_MASTER_READINESS_GROUPS.flatMap((group) =>
    group.items.map((item) => item.href),
  );
}
