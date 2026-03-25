'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Users,
  Calendar,
  Pill,
  ClipboardCheck,
  Car,
  FileText,
  Settings,
  Database,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/stores/ui-store';
import { Button } from '@/components/ui/button';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const mainNavItems: NavItem[] = [
  { label: 'ホーム', href: '/dashboard', icon: Home },
  { label: '患者', href: '/dashboard/patients', icon: Users },
  { label: 'スケジュール', href: '/dashboard/schedule', icon: Calendar },
  { label: '調剤', href: '/dashboard/dispensing', icon: Pill },
  { label: '鑑査', href: '/dashboard/inspection', icon: ClipboardCheck },
  { label: '訪問', href: '/dashboard/visits', icon: Car },
  { label: '報告', href: '/dashboard/reports', icon: FileText },
];

const adminNavItems: NavItem[] = [
  { label: '設定', href: '/dashboard/settings', icon: Settings },
  { label: 'マスタ', href: '/dashboard/master', icon: Database },
  { label: '監査ログ', href: '/dashboard/audit', icon: ScrollText },
];

interface SidebarNavItemProps {
  item: NavItem;
  collapsed: boolean;
}

function SidebarNavItem({ item, collapsed }: SidebarNavItemProps) {
  const pathname = usePathname();
  const isActive =
    item.href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname.startsWith(item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
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

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { sidebarOpen, toggleSidebar } = useUIStore();

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border bg-sidebar transition-all duration-200',
        sidebarOpen ? 'w-56' : 'w-16',
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
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5" role="list">
          {mainNavItems.map((item) => (
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
          {adminNavItems.map((item) => (
            <li key={item.href}>
              <SidebarNavItem item={item} collapsed={!sidebarOpen} />
            </li>
          ))}
        </ul>
      </nav>

      {/* User / logout */}
      <div className="shrink-0 border-t border-border p-2">
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
