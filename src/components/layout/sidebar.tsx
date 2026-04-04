'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CalendarOff,
  Car,
  CheckSquare,
  ChevronDown,
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
  LogOut,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pill,
  Pin,
  PinOff,
  QrCode,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  Stethoscope,
  UserCircle,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/stores/ui-store';
import { Button } from '@/components/ui/button';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  activePrefixes?: string[];
  excludePrefixes?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const mainNavGroups: NavGroup[] = [
  {
    label: '基本',
    items: [
      { label: 'ホーム', href: '/dashboard', icon: Home },
      { label: '患者', href: '/patients', icon: Users },
    ],
  },
  {
    label: '処方・調剤',
    items: [
      {
        label: '処方受付',
        href: '/prescriptions',
        icon: ClipboardPlus,
        activePrefixes: ['/prescriptions'],
      },
      { label: '調剤', href: '/dispensing', icon: Pill },
      { label: '鑑査', href: '/auditing', icon: ClipboardCheck },
      { label: 'セット', href: '/medication-sets', icon: Package },
      { label: 'QRスキャン', href: '/qr-scan', icon: QrCode },
    ],
  },
  {
    label: '訪問・報告',
    items: [
      { label: 'スケジュール', href: '/schedules', icon: Calendar },
      {
        label: '訪問',
        href: '/visits',
        icon: Car,
        excludePrefixes: ['/visits/handoffs'],
      },
      { label: '報告', href: '/reports', icon: FileText },
      {
        label: '申し送り',
        href: '/handoff',
        icon: ClipboardList,
        activePrefixes: ['/handoff', '/visits/handoffs'],
      },
    ],
  },
  {
    label: '連携',
    items: [
      { label: '多職種連携', href: '/conferences', icon: Users },
    ],
  },
];

const workbenchNavItems: NavItem[] = [
  { label: 'My Day', href: '/my-day', icon: Clock3 },
  { label: 'ワークフロー', href: '/workflow', icon: ListChecks },
  { label: 'タスク', href: '/tasks', icon: CheckSquare },
  { label: '請求', href: '/billing', icon: ScrollText },
  { label: '管理', href: '/admin', icon: Shield, activePrefixes: ['/admin'] },
  { label: '通知', href: '/notifications', icon: Bell },
  { label: '依頼・照会', href: '/communications/requests', icon: MessageSquare },
  { label: '外部連携', href: '/external', icon: Stethoscope },
];

const adminNavGroups: NavGroup[] = [
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
    items: [
      { label: 'UAT', href: '/admin/uat', icon: MessageSquare },
    ],
  },
];

interface SidebarNavItemProps {
  item: NavItem;
  collapsed: boolean;
}

function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function SidebarNavItem({ item, collapsed }: SidebarNavItemProps) {
  const pathname = usePathname();
  const { sidebarPinned, setSidebarOpen } = useUIStore();
  const activePrefixes = item.activePrefixes ?? [item.href];
  const isExcluded =
    item.excludePrefixes?.some((prefix) => matchesPathPrefix(pathname, prefix)) ?? false;
  const isActive =
    !isExcluded &&
    (item.href === '/dashboard'
      ? pathname === '/dashboard'
      : activePrefixes.some((prefix) => matchesPathPrefix(pathname, prefix)));
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={() => { if (!sidebarPinned) setSidebarOpen(false); }}
      data-testid={
        item.href === '/dashboard'
          ? 'sidebar-nav-home'
          : item.href === '/patients'
            ? 'sidebar-nav-patients'
            : undefined
      }
      className={cn(
        'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-sidebar-foreground hover:bg-muted hover:text-foreground',
        collapsed && 'justify-center px-2'
      )}
      aria-current={isActive ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

function SidebarAdminGroup({
  group,
  collapsed,
}: {
  group: NavGroup;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const hasActiveChild = group.items.some((item) => {
    const prefixes = item.activePrefixes ?? [item.href];
    return prefixes.some((p) => matchesPathPrefix(pathname, p));
  });
  const [open, setOpen] = useState(hasActiveChild);

  if (collapsed) {
    return (
      <>
        {group.items.map((item) => (
          <li key={item.href}>
            <SidebarNavItem item={item} collapsed />
          </li>
        ))}
      </>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full min-h-[32px] items-center gap-2 rounded-md px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          hasActiveChild && 'text-foreground'
        )}
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 transition-transform',
            !open && '-rotate-90'
          )}
          aria-hidden="true"
        />
        <span>{group.label}</span>
      </button>
      {open && (
        <ul className="space-y-0.5 pl-2" role="list">
          {group.items.map((item) => (
            <li key={item.href}>
              <SidebarNavItem item={item} collapsed={false} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();
  const { sidebarOpen, sidebarPinned, toggleSidebar, toggleSidebarPinned } = useUIStore();

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border bg-sidebar transition-all duration-200',
        sidebarOpen ? 'w-48 xl:w-56' : 'w-16',
        className
      )}
      aria-label="メインナビゲーション"
    >
      {/* Logo */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b border-border px-3',
          sidebarOpen ? 'justify-between' : 'justify-center'
        )}
      >
        {sidebarOpen && (
          <Link
            href="/dashboard"
            className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-base font-bold tracking-tight text-primary">
              CareViaX
            </span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="h-8 w-8 shrink-0"
          aria-label={sidebarOpen ? 'サイドバーを折りたたむ' : 'サイドバーを展開する'}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      <div className="border-b border-border px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebarPinned}
          className={cn('w-full justify-start gap-2', !sidebarOpen && 'justify-center px-2')}
          aria-label={sidebarPinned ? 'サイドバー固定を解除' : 'サイドバーを固定'}
          title={!sidebarOpen ? (sidebarPinned ? '固定中' : '固定する') : undefined}
        >
          {sidebarPinned ? (
            <Pin className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PinOff className="h-4 w-4" aria-hidden="true" />
          )}
          {sidebarOpen && <span>{sidebarPinned ? '固定中' : '固定する'}</span>}
        </Button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="ワークフローナビ">
        {mainNavGroups.map((group, groupIndex) => (
          <div key={group.label}>
            {groupIndex > 0 && <div className="my-2 border-t border-border/50" />}
            {sidebarOpen && (
              <p className="mb-0.5 px-3 pt-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5" role="list">
              {group.items.map((item) => (
                <li key={item.href}>
                  <SidebarNavItem item={item} collapsed={!sidebarOpen} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="my-2 border-t border-border" />

        {sidebarOpen && (
          <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            ワークベンチ
          </p>
        )}
        <ul className="space-y-0.5" role="list">
          {workbenchNavItems.map((item) => (
            <li key={item.href}>
              <SidebarNavItem item={item} collapsed={!sidebarOpen} />
            </li>
          ))}
        </ul>

        <div className="my-2 border-t border-border" />

        {sidebarOpen && (
          <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            管理
          </p>
        )}
        <ul className="space-y-0.5" role="list">
          {adminNavGroups.map((group) => (
            <SidebarAdminGroup
              key={group.label}
              group={group}
              collapsed={!sidebarOpen}
            />
          ))}
        </ul>
      </nav>

      {/* User settings & logout */}
      <div className="shrink-0 border-t border-border p-2">
        <Link
          href="/settings"
          className={cn(
            'flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !sidebarOpen && 'justify-center px-2'
          )}
          title={!sidebarOpen ? '設定' : undefined}
        >
          <UserCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          {sidebarOpen && <span>設定</span>}
        </Link>
        <button
          type="button"
          className={cn(
            'flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !sidebarOpen && 'justify-center px-2'
          )}
          aria-label="ログアウト"
          title={!sidebarOpen ? 'ログアウト' : undefined}
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          {sidebarOpen && <span>ログアウト</span>}
        </button>
      </div>
    </aside>
  );
}
