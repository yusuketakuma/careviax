import type { ElementType } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CalendarOff,
  Car,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  Cog,
  Database,
  FileText,
  Gauge,
  GraduationCap,
  Home,
  Hospital,
  LineChart,
  MessageSquare,
  Package,
  Pill,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  Stethoscope,
  UserCircle,
  Users,
} from 'lucide-react';

export type LayoutNavBadgeTone = 'critical' | 'caution';

export type LayoutNavItem = {
  label: string;
  href: string;
  icon: ElementType;
  /** Active when pathname matches one of these prefixes (defaults to [href]). */
  activePrefixes?: string[];
  /** Never active when pathname matches one of these prefixes. */
  excludePrefixes?: string[];
  /** Never active when pathname equals one of these paths exactly. */
  excludeExact?: string[];
  /** When true, activePrefixes must equal the pathname exactly (sub paths do not match). */
  exact?: boolean;
  badge?: number;
  /** Badge color semantics: critical = red (要対応), caution = amber (注意). */
  badgeTone?: LayoutNavBadgeTone;
};

export type LayoutNavGroup = {
  label: string;
  items: LayoutNavItem[];
};

export const MOBILE_BOTTOM_NAV_ITEMS: readonly LayoutNavItem[] = [
  { label: 'ホーム', href: '/dashboard', icon: Home },
  { label: 'スケジュール', href: '/schedules', icon: Calendar },
  {
    label: '訪問',
    href: '/visits',
    icon: Car,
    activePrefixes: ['/visits', '/my-day', '/offline-sync'],
  },
  { label: '患者', href: '/patients', icon: Users },
];

/**
 * design/images/new のサイドバー構成(01/02/06/08/12 共通)。
 * グループ見出し付き(今日/患者/工程/連携/管理)。デザインのメニューに無い
 * 既存ページは activePrefixes で最も近い項目のアクティブ範囲に含める
 * (到達導線はダッシュボード/検索/上部バー)。
 *
 * 患者一覧とカードのアクティブ分離:
 * - 患者一覧 = /patients(一覧・新規登録の完全一致系)
 * - カード   = /patients/[id](患者詳細 = 処方サイクル作業台)と /prescriptions
 */
export const SIDEBAR_MAIN_NAV_GROUPS: readonly LayoutNavGroup[] = [
  {
    label: '今日',
    items: [
      {
        label: 'ダッシュボード',
        href: '/dashboard',
        icon: Home,
        activePrefixes: ['/dashboard', '/workflow', '/tasks', '/today', '/notifications'],
      },
      { label: 'スケジュール', href: '/schedules', icon: Calendar },
      {
        label: '訪問',
        href: '/visits',
        icon: Car,
        activePrefixes: ['/visits', '/my-day', '/offline-sync'],
      },
    ],
  },
  {
    label: '患者',
    items: [
      {
        label: '患者一覧',
        href: '/patients',
        icon: Users,
        exact: true,
        activePrefixes: ['/patients', '/patients/new'],
      },
    ],
  },
  {
    label: '工程',
    items: [
      {
        label: '処方取込',
        href: '/prescriptions/intake',
        icon: ClipboardPlus,
        activePrefixes: ['/prescriptions/intake', '/prescriptions/new', '/qr-scan'],
      },
      {
        label: 'カード',
        href: '/prescriptions',
        icon: ScrollText,
        activePrefixes: ['/prescriptions', '/patients'],
        excludePrefixes: ['/prescriptions/new', '/prescriptions/intake'],
        excludeExact: ['/patients', '/patients/new'],
      },
      { label: '調剤', href: '/dispense', icon: Pill },
      { label: '監査', href: '/auditing', icon: ClipboardCheck, badgeTone: 'critical' },
      { label: 'セット', href: '/medication-sets', icon: Package },
      { label: '報告・共有', href: '/reports', icon: FileText },
      { label: '算定チェック', href: '/billing', icon: Receipt },
    ],
  },
  {
    label: '連携',
    items: [
      {
        label: 'ハンドオフ',
        href: '/handoff',
        icon: ClipboardList,
        activePrefixes: ['/handoff', '/communications', '/conferences', '/external'],
        badgeTone: 'caution',
      },
    ],
  },
  {
    label: '管理',
    items: [
      {
        label: 'マスター',
        href: '/admin',
        icon: Database,
        activePrefixes: ['/admin'],
      },
      { label: '設定', href: '/settings', icon: Settings },
    ],
  },
];

export const SIDEBAR_ADMIN_NAV_GROUPS: readonly LayoutNavGroup[] = [
  {
    label: '運営',
    items: [
      { label: 'マスター', href: '/admin', icon: Home },
      { label: '管理設定', href: '/admin/settings', icon: Settings },
      { label: '薬局情報', href: '/admin/pharmacy-sites', icon: Building2 },
      { label: '休日カレンダー', href: '/admin/business-holidays', icon: CalendarOff },
      { label: '請求ルール', href: '/admin/billing-rules', icon: Receipt },
    ],
  },
  {
    label: 'スタッフ',
    items: [
      { label: 'スタッフ', href: '/admin/staff', icon: Users },
      { label: 'ユーザー', href: '/admin/users', icon: UserCircle },
      { label: 'シフト', href: '/admin/shifts', icon: Calendar },
      { label: '薬剤師資格', href: '/admin/pharmacist-credentials', icon: GraduationCap },
    ],
  },
  {
    label: '施設・連携先',
    items: [
      { label: '施設', href: '/admin/facilities', icon: Building2 },
      { label: '医療機関', href: '/admin/institutions', icon: Hospital },
      { label: 'PCAポンプ', href: '/admin/pca-pumps', icon: Package },
      { label: '他職種', href: '/admin/external-professionals', icon: Stethoscope },
      { label: '連携先', href: '/admin/contact-profiles', icon: Users },
      { label: '訪問エリア', href: '/admin/service-areas', icon: Car },
      { label: '施設基準', href: '/admin/facility-standards', icon: Shield },
    ],
  },
  {
    label: '薬剤',
    items: [
      { label: '採用薬', href: '/admin/formulary', icon: Pill },
      { label: '配薬方法', href: '/admin/packaging-methods', icon: Package },
      { label: 'マスタ', href: '/admin/drug-masters', icon: Database },
      { label: '処方安全アラート', href: '/admin/alert-rules', icon: ClipboardCheck },
    ],
  },
  {
    label: '文書・通知',
    items: [
      { label: '文書テンプレート', href: '/admin/document-templates', icon: FileText },
      { label: '通知設定', href: '/admin/notification-settings', icon: Bell },
    ],
  },
  {
    label: '分析・監視',
    items: [
      { label: 'データ探索', href: '/admin/data-explorer', icon: Database },
      { label: '監査ログ', href: '/admin/audit-logs', icon: ScrollText },
      { label: 'ジョブ', href: '/admin/jobs', icon: Cog },
      { label: '経営指標', href: '/admin/metrics', icon: BarChart3 },
      { label: 'KPI分析', href: '/admin/analytics', icon: LineChart },
      { label: '在宅業務の動き', href: '/admin/operations-insights', icon: LineChart },
      { label: '在庫予測', href: '/admin/inventory-forecast', icon: Package },
      { label: 'パフォーマンス', href: '/admin/performance', icon: Activity },
      { label: 'キャパシティ', href: '/admin/capacity', icon: Gauge },
      { label: 'リアルタイム監視', href: '/admin/realtime', icon: Activity },
    ],
  },
  {
    label: 'その他',
    items: [{ label: 'UAT', href: '/admin/uat', icon: MessageSquare }],
  },
];
