import type { ElementType } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CalendarOff,
  Car,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  Clock3,
  Cog,
  Database,
  FileText,
  GraduationCap,
  Home,
  Hospital,
  LineChart,
  ListChecks,
  MessageSquare,
  Package,
  Pill,
  QrCode,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  Stethoscope,
  UserCircle,
  Users,
} from 'lucide-react';

export type LayoutNavItem = {
  label: string;
  href: string;
  icon: ElementType;
  activePrefixes?: string[];
  excludePrefixes?: string[];
  badge?: number;
};

export type LayoutNavGroup = {
  label: string;
  items: LayoutNavItem[];
};

export type TopWorkflowLink = {
  label: string;
  href: string;
  activePrefixes: string[];
  excludePrefixes?: string[];
};

export const TOP_WORKFLOW_LINKS: readonly TopWorkflowLink[] = [
  { label: '業務本流', href: '/workflow', activePrefixes: ['/workflow'] },
  { label: 'スケジュール', href: '/schedules', activePrefixes: ['/schedules'] },
  {
    label: '訪問時',
    href: '/visits',
    activePrefixes: ['/visits', '/my-day'],
    excludePrefixes: ['/visits/handoffs'],
  },
  { label: '報告書', href: '/reports', activePrefixes: ['/reports'] },
];

export const MOBILE_BOTTOM_NAV_ITEMS: readonly LayoutNavItem[] = [
  { label: 'ホーム', href: '/dashboard', icon: Home },
  { label: 'スケジュール', href: '/schedules', icon: Calendar },
  {
    label: '訪問時',
    href: '/visits',
    icon: Car,
    activePrefixes: ['/visits', '/my-day'],
    excludePrefixes: ['/visits/handoffs'],
  },
  { label: '患者', href: '/patients', icon: Users },
];

export const SIDEBAR_MAIN_NAV_GROUPS: readonly LayoutNavGroup[] = [
  {
    label: '主要',
    items: [
      { label: 'ホーム', href: '/dashboard', icon: Home },
      { label: '患者', href: '/patients', icon: Users },
      { label: 'ワークフロー', href: '/workflow', icon: ListChecks },
    ],
  },
  {
    label: '主業務ルート',
    items: [
      {
        label: '処方登録',
        href: '/prescriptions',
        icon: ClipboardPlus,
        activePrefixes: ['/prescriptions'],
      },
      { label: '調剤', href: '/dispensing', icon: Pill },
      { label: '調剤監査', href: '/auditing', icon: ClipboardCheck },
      {
        label: 'セット',
        href: '/medication-sets',
        icon: Package,
        excludePrefixes: ['/medication-sets/audit'],
      },
      {
        label: 'セット監査',
        href: '/medication-sets',
        icon: ClipboardCheck,
        activePrefixes: ['/medication-sets/audit'],
      },
      { label: 'スケジュール', href: '/schedules', icon: Calendar },
      {
        label: '訪問時',
        href: '/visits',
        icon: Car,
        excludePrefixes: ['/visits/handoffs'],
      },
      { label: '報告書', href: '/reports', icon: FileText },
    ],
  },
  {
    label: '補助導線',
    items: [
      { label: 'QRスキャン', href: '/qr-scan', icon: QrCode },
      {
        label: '申し送り',
        href: '/handoff',
        icon: ClipboardList,
        activePrefixes: ['/handoff', '/visits/handoffs'],
      },
      { label: '多職種連携', href: '/conferences', icon: Users },
      { label: '依頼・照会', href: '/communications/requests', icon: MessageSquare },
      { label: '外部連携', href: '/external', icon: Stethoscope },
    ],
  },
];

export const SIDEBAR_WORKBENCH_NAV_ITEMS: readonly LayoutNavItem[] = [
  { label: 'My Day', href: '/my-day', icon: Clock3 },
  { label: 'タスク', href: '/tasks', icon: CheckSquare },
  { label: '請求', href: '/billing', icon: ScrollText },
  { label: '管理', href: '/admin', icon: Shield, activePrefixes: ['/admin'] },
  { label: '通知', href: '/notifications', icon: Bell },
];

export const SIDEBAR_ADMIN_NAV_GROUPS: readonly LayoutNavGroup[] = [
  {
    label: '運営',
    items: [
      { label: '管理ダッシュボード', href: '/admin', icon: Home },
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
      { label: 'パフォーマンス', href: '/admin/performance', icon: Activity },
      { label: 'リアルタイム監視', href: '/admin/realtime', icon: Activity },
    ],
  },
  {
    label: 'その他',
    items: [{ label: 'UAT', href: '/admin/uat', icon: MessageSquare }],
  },
];
