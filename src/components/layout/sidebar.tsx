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
  QrCode,
  Settings,
  Database,
  ScrollText,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
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
  { label: '患者', href: '/patients', icon: Users },
  { label: 'スケジュール', href: '/schedules', icon: Calendar },
  { label: '調剤', href: '/dispensing', icon: Pill },
  { label: '鑑査', href: '/auditing', icon: ClipboardCheck },
  { label: '訪問', href: '/visits', icon: Car },
  { label: '報告', href: '/reports', icon: FileText },
  { label: 'QRスキャン', href: '/qr-scan', icon: QrCode },
];

const adminNavItems: NavItem[] = [
  { label: '設定', href: '/admin/settings', icon: Settings },
  { label: '文書テンプレート', href: '/admin/document-templates', icon: FileText },
  { label: 'マスタ', href: '/admin/drug-masters', icon: Database },
  { label: '監査ログ', href: '/admin/audit-logs', icon: ScrollText },
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
  const { sidebarOpen, sidebarPinned, toggleSidebar, toggleSidebarPinned } = useUIStore();

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
